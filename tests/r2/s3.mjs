// Test-only S3 adapter. Object semantics come from Miniflare, not an in-memory fake.
import { AwsV4Signer } from "aws4fetch";

const credentials = { accessKeyId: "test-access", secretAccessKey: "test-secret",
  service: "s3", region: "auto" };
const xml = value => String(value).replace(/[<>&"']/g,
  character => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]);

async function authorized(request) {
  const url = new URL(request.url), query = url.searchParams;
  const signature = query.get("X-Amz-Signature");
  if (signature) {
    const datetime = query.get("X-Amz-Date"), ttl = Number(query.get("X-Amz-Expires"));
    const issued = Date.parse(datetime.replace(/^(....)(..)(..)T(..)(..)(..)Z$/, "$1-$2-$3T$4:$5:$6Z"));
    if (!ttl || Date.now() >= issued + ttl * 1000) return false;
    query.delete("X-Amz-Signature");
    const signer = new AwsV4Signer({ ...credentials, url, method: request.method,
      datetime, signQuery: true });
    return signature === await signer.signature();
  }
  const authorization = request.headers.get("Authorization") ?? "";
  const signedHeaders = /SignedHeaders=([^,]+)/.exec(authorization)?.[1]?.split(";") ?? [];
  const headers = new Headers();
  for (const name of signedHeaders) if (name !== "host") headers.set(name, request.headers.get(name));
  const signer = new AwsV4Signer({ ...credentials, url, method: request.method, headers,
    datetime: headers.get("X-Amz-Date"), allHeaders: true });
  return authorization === await signer.authHeader();
}

export default {
  async fetch(request, { BUCKET }) {
    if (!await authorized(request)) return new Response("Forbidden", { status: 403 });
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname).split("/").slice(2).join("/");
    if (url.searchParams.get("list-type") === "2") {
      const page = await BUCKET.list({ prefix: url.searchParams.get("prefix") ?? "",
        cursor: url.searchParams.get("continuation-token") ?? undefined, limit: 2 });
      const contents = page.objects.map(object => `<Contents><Key>${xml(object.key)}</Key>` +
        `<LastModified>${object.uploaded.toISOString()}</LastModified><ETag>${xml(object.httpEtag)}</ETag>` +
        `<Size>${object.size}</Size></Contents>`).join("");
      return new Response(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
        `<IsTruncated>${page.truncated}</IsTruncated>${page.truncated ?
          `<NextContinuationToken>${xml(page.cursor)}</NextContinuationToken>` : ""}` +
        `${contents}</ListBucketResult>`, { headers: { "Content-Type": "application/xml" } });
    }
    if (request.method === "POST" && url.searchParams.has("delete")) {
      const keys = [...(await request.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map(match => match[1]);
      await BUCKET.delete(keys);
      return new Response(`<DeleteResult>${keys.map(key => `<Deleted><Key>${xml(key)}</Key></Deleted>`).join("")}</DeleteResult>`,
        { headers: { "Content-Type": "application/xml" } });
    }
    if (request.method === "DELETE") {
      await BUCKET.delete(key);
      return new Response(null, { status: 204 });
    }
    let object;
    if (request.method === "PUT") {
      object = await BUCKET.put(key, request.body, { httpMetadata: request.headers });
      return new Response(null, { headers: { ETag: object.httpEtag } });
    } else {
      object = await BUCKET.get(key);
    }
    if (!object) return new Response(null, { status: 404 });
    const headers = new Headers({ ETag: object.httpEtag,
      "Last-Modified": object.uploaded.toUTCString(), "Content-Length": String(object.size) });
    object.writeHttpMetadata(headers);
    return new Response(request.method === "GET" ? object.body : null, { headers });
  }
};
