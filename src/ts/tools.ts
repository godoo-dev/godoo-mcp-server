import type { Domain } from "@godoo-dev/client";
import MarkdownIt from "markdown-it";
import { z } from "zod";
import { deliverArtifact, deliverRecordResult } from "./artifacts.js";
import { PublicError } from "./errors.js";
import {
  compileDomain,
  discover,
  prepareCreate,
  prepareUpdate,
  readProperties,
} from "./properties.js";
import type { Operation, Registration, ToolArguments } from "./types.js";

const object = z.record(z.string(), z.unknown());
const properties = z.record(z.string(), object).nullable().optional();
const domain = z.array(z.unknown()).nullable().optional();
const fields = z.array(z.string()).nullable().optional();
const ids = z.array(z.number().int());
const limit = z.number().int().default(80);
const offset = z.number().int().default(0);
const maxReturnBytes = z.number().int().nonnegative().nullable().default(500);
const bodyFormat = z.enum(["md", "html", "txt"]).default("md");
const markdown = new MarkdownIt("commonmark", { html: true, breaks: true, xhtmlOut: true }).enable([
  "table",
  "strikethrough",
]);

/** Public navigation links must never include credentials or URL capabilities. */
export function publicOdooUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function recordWebUrls(
  url: string,
  model: string,
  recordIds: number[],
): Record<string, string> {
  const base = publicOdooUrl(url);
  if (base === null) return {};
  return Object.fromEntries(
    recordIds.map((id) => [
      String(id),
      `${base}/web#${new URLSearchParams({ model, id: String(id) })}`,
    ]),
  );
}

/** Called by the outer request wrapper before creating/authenticating a client. */
export function validateModelCallArguments(args: ToolArguments): void {
  const kwargs = args.kwargs;
  if (kwargs && typeof kwargs === "object" && !Array.isArray(kwargs) && "context" in kwargs) {
    const context = kwargs.context;
    if (context === null || typeof context !== "object" || Array.isArray(context)) {
      throw new PublicError("kwargs.context must be an object", "invalid_arguments");
    }
  }
}

export function htmlBody(body: string, format: "md" | "html" | "txt"): string {
  if (!body.trim()) throw new PublicError("Message body must not be empty", "invalid_arguments");
  if (format === "md") return markdown.render(body);
  if (format === "html") return body;
  const escaped = body
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
  return `<p>${escaped.replaceAll("\n", "<br>")}</p>`;
}

function binary(base64: string): Uint8Array {
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function recordIds(records: Record<string, unknown>[]): number[] {
  return records.flatMap((record) => (typeof record.id === "number" ? [record.id] : []));
}

function truth(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function activityId(result: unknown): number {
  let value = result;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "number") value = value[0];
  if (typeof value === "string") {
    const match = /^(?:mail\.activity\(([1-9][0-9]*),?\)|([1-9][0-9]*))$/.exec(value);
    if (match) value = Number(match[1] ?? match[2]);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new PublicError(
      "Odoo write outcome is unknown; do not retry automatically",
      "unknown_write",
    );
  }
  return value;
}

export function registerTools({ register }: Registration): void {
  function add<Shape extends z.ZodRawShape>(
    name: string,
    schema: Shape,
    handler: (args: z.output<z.ZodObject<Shape>>, operation: Operation) => Promise<unknown>,
  ): void {
    register(name, schema, (args, operation) =>
      handler(args as z.output<z.ZodObject<Shape>>, operation),
    );
  }

  add("users_whoami", {}, async (_args, { client, creds }) => ({
    uid: client.getSession()?.uid,
    username: creds.username,
    database: client.getSession()?.db,
    url: publicOdooUrl(creds.url),
  }));

  add("users_search_users", { domain, fields, limit, offset }, async (args, { client }) => {
    const users = await client.searchRead("res.users", (args.domain ?? []) as Domain, {
      fields: args.fields?.length ? args.fields : ["id", "name", "login", "active", "share"],
      limit: args.limit,
      offset: args.offset,
    });
    return { users, count: users.length };
  });

  add("discovery_list_models", {}, async (_args, { client }) => ({
    models: await client.searchRead("ir.model", [], {
      fields: ["model", "name", "info"],
      limit: 500,
      order: "model",
    }),
  }));

  add(
    "discovery_get_fields",
    {
      model: z.string(),
      attributes: fields,
      record_id: z.number().int().nullable().optional(),
      property_field: z.string().nullable().optional(),
      parent_id: z.number().int().nullable().optional(),
    },
    async (args, { client }) => {
      const result: Record<string, unknown> = {
        model: args.model,
        fields: await client.call(args.model, "fields_get", [], {
          attributes: args.attributes?.length
            ? args.attributes
            : ["string", "type", "required", "readonly", "help", "relation"],
        }),
      };
      if (args.record_id != null || args.property_field != null || args.parent_id != null) {
        result.properties = await discover(
          client,
          args.model,
          args.record_id ?? undefined,
          args.property_field ?? undefined,
          args.parent_id ?? undefined,
        );
      }
      return result;
    },
  );

  add("discovery_list_menus", { domain, limit }, async (args, { client }) => {
    const menus = await client.searchRead("ir.ui.menu", (args.domain ?? []) as Domain, {
      fields: ["id", "name", "complete_name", "parent_id", "action", "sequence"],
      limit: args.limit,
      order: "sequence",
    });
    return { menus, count: menus.length };
  });

  add("action_list_actions", { domain, limit }, async (args, { client }) => {
    const server = await client.searchRead("ir.actions.server", (args.domain ?? []) as Domain, {
      fields: ["id", "name", "model_id", "binding_model_id", "code"],
      limit: args.limit,
    });
    const window = await client.searchRead("ir.actions.act_window", (args.domain ?? []) as Domain, {
      fields: ["id", "name", "res_model", "view_mode"],
      limit: args.limit,
    });
    const actions = [
      ...server.map((action) => ({ ...action, action_type: "server" })),
      ...window.map((action) => ({ ...action, action_type: "window" })),
    ];
    return { actions, count: actions.length };
  });

  add("action_execute_action", { action_id: z.number().int() }, async (args, op) => {
    op.markWrite();
    const result = await op.client.call("ir.actions.server", "run", [args.action_id], {});
    return { result: result ?? {} };
  });

  add(
    "model_call",
    {
      model: z.string().min(1),
      method: z.string().min(1),
      args: z.array(z.unknown()).nullable().optional(),
      kwargs: object.nullable().optional(),
    },
    async (args, op) => {
      validateModelCallArguments(args);
      op.markWrite();
      return {
        result: await op.client.call(
          args.model,
          args.method,
          (args.args ?? []) as Parameters<typeof op.client.call>[2],
          args.kwargs ?? {},
        ),
      };
    },
  );

  add(
    "record_search",
    {
      model: z.string(),
      domain,
      fields,
      limit,
      offset,
      order: z.string().nullable().optional(),
      max_return_bytes: maxReturnBytes,
    },
    async (args, { client, creds, runtime }) => {
      if (args.order?.split(",").some((part) => part.trim().startsWith("properties."))) {
        throw new PublicError("Ordering by friendly properties is unsupported", "property_order");
      }
      const friendly = args.fields?.some((field) => field.startsWith("properties."));
      const compiled = await compileDomain(client, args.model, args.domain ?? []);
      let records = await client.searchRead(args.model, compiled as Domain, {
        ...(friendly ? { fields: ["id"] } : args.fields ? { fields: args.fields } : {}),
        limit: args.limit,
        offset: args.offset,
        ...(args.order ? { order: args.order } : {}),
      });
      if (friendly && args.fields)
        records = await readProperties(client, args.model, recordIds(records), args.fields);
      return deliverRecordResult(
        {
          records,
          count: records.length,
          web_urls: recordWebUrls(creds.url, args.model, recordIds(records)),
        },
        {
          maxReturnBytes: args.max_return_bytes,
          model: args.model,
          tool: "record_search",
          rowCount: records.length,
        },
        runtime,
      );
    },
  );

  add(
    "record_read",
    { model: z.string(), ids, fields, max_return_bytes: maxReturnBytes },
    async (args, { client, creds, runtime }) => {
      const records = args.fields?.some((field) => field.startsWith("properties."))
        ? await readProperties(client, args.model, args.ids, args.fields)
        : await client.read(args.model, args.ids, args.fields ?? undefined);
      return deliverRecordResult(
        { records, web_urls: recordWebUrls(creds.url, args.model, recordIds(records)) },
        {
          maxReturnBytes: args.max_return_bytes,
          model: args.model,
          tool: "record_read",
          rowCount: records.length,
        },
        runtime,
      );
    },
  );

  add("record_create", { model: z.string(), values: object, properties }, async (args, op) => {
    const payload =
      args.properties == null
        ? args.values
        : await prepareCreate(op.client, args.model, args.properties, args.values);
    op.markWrite();
    const id = await op.client.create(
      args.model,
      payload,
      args.properties == null ? undefined : { lang: "en_US" },
    );
    return { id, web_url: recordWebUrls(op.creds.url, args.model, [id])[String(id)] ?? null };
  });

  add(
    "record_update",
    { model: z.string(), ids, values: object.nullable().optional(), properties },
    async (args, op) => {
      let payload = args.values ?? {};
      if (args.properties != null) {
        if (args.ids.length !== 1 || args.ids[0] <= 0) {
          throw new PublicError(
            "Property updates require exactly one positive record ID",
            "property_scope",
          );
        }
        payload = await prepareUpdate(op.client, args.model, args.ids[0], args.properties, payload);
      } else if (args.values == null) {
        throw new PublicError("Supply values or properties to update", "update_values");
      }
      op.markWrite();
      const success = await op.client.write(
        args.model,
        args.ids,
        payload,
        args.properties == null ? undefined : { lang: "en_US" },
      );
      return {
        success,
        web_urls: success ? recordWebUrls(op.creds.url, args.model, args.ids) : {},
      };
    },
  );

  add("record_delete", { model: z.string(), ids }, async (args, op) => {
    op.markWrite();
    return { success: await op.client.unlink(args.model, args.ids) };
  });

  const message = {
    model: z.string(),
    res_id: z.number().int(),
    body: z.string(),
    body_format: bodyFormat,
  };
  add(
    "mail_post_message",
    {
      ...message,
      is_internal: z.boolean().default(false),
      partner_ids: ids.nullable().optional(),
      attachment_ids: ids.nullable().optional(),
    },
    async (args, op) => {
      const body = htmlBody(args.body, args.body_format);
      const post = args.is_internal
        ? op.client.mail.postInternalNote.bind(op.client.mail)
        : op.client.mail.postOpenMessage.bind(op.client.mail);
      op.markWrite();
      return {
        message_id: await post(args.model, args.res_id, body, {
          partnerIds: args.partner_ids ?? [],
          attachmentIds: args.attachment_ids ?? [],
        }),
      };
    },
  );

  add("mail_log_note", message, async (args, op) => {
    const body = htmlBody(args.body, args.body_format);
    op.markWrite();
    return { message_id: await op.client.mail.postInternalNote(args.model, args.res_id, body) };
  });

  add(
    "mail_list_messages",
    { model: z.string(), res_id: z.number().int(), limit, offset },
    async (args, { client }) => {
      const messages = await client.searchRead(
        "mail.message",
        [
          ["model", "=", args.model],
          ["res_id", "=", args.res_id],
        ],
        {
          fields: ["id", "body", "author_id", "date", "message_type", "subtype_id", "is_internal"],
          limit: args.limit,
          offset: args.offset,
          order: "date desc",
        },
      );
      return { messages, count: messages.length };
    },
  );

  add(
    "mail_schedule_activity",
    {
      model: z.string(),
      res_id: z.number().int(),
      activity_type_id: z.number().int(),
      date_deadline: z.string(),
      note: z.string().nullable().optional(),
      user_id: z.number().int().nullable().optional(),
    },
    async (args, op) => {
      const kwargs = {
        activity_type_id: args.activity_type_id,
        date_deadline: args.date_deadline,
        ...(args.note != null ? { note: args.note } : {}),
        ...(args.user_id != null ? { user_id: args.user_id } : {}),
      };
      op.markWrite();
      return {
        activity_id: activityId(
          await op.client.call(args.model, "activity_schedule", [args.res_id], kwargs),
        ),
      };
    },
  );

  add(
    "mail_list_activities",
    { model: z.string(), res_id: z.number().int(), limit },
    async (args, { client }) => {
      const activities = await client.searchRead(
        "mail.activity",
        [
          ["res_model", "=", args.model],
          ["res_id", "=", args.res_id],
        ],
        {
          fields: [
            "id",
            "activity_type_id",
            "date_deadline",
            "note",
            "user_id",
            "state",
            "summary",
          ],
          limit: args.limit,
        },
      );
      return { activities, count: activities.length };
    },
  );

  add(
    "mail_mark_activity_done",
    { activity_id: z.number().int(), feedback: z.string().default("") },
    async (args, op) => {
      op.markWrite();
      return {
        success: truth(
          await op.client.call("mail.activity", "action_feedback", [args.activity_id], {
            feedback: args.feedback,
          }),
        ),
      };
    },
  );

  add(
    "attachments_list",
    {
      domain,
      limit,
      res_model: z.string().nullable().optional(),
      res_id: z.number().int().nullable().optional(),
    },
    async (args, { client }) => {
      const effective = [...(args.domain ?? [])];
      if (args.res_model != null) effective.push(["res_model", "=", args.res_model]);
      if (args.res_id != null) effective.push(["res_id", "=", args.res_id]);
      const attachments = await client.searchRead("ir.attachment", effective as Domain, {
        fields: ["id", "name", "mimetype", "file_size", "res_model", "res_id", "create_date"],
        limit: args.limit,
      });
      return { attachments, count: attachments.length };
    },
  );

  add(
    "attachments_upload",
    {
      name: z.string(),
      content_base64: z.string(),
      res_model: z.string(),
      res_id: z.number().int(),
      mimetype: z.string().nullable().optional(),
    },
    async (args, op) => {
      op.markWrite();
      return {
        id: await op.client.create("ir.attachment", {
          name: args.name,
          datas: args.content_base64,
          res_model: args.res_model,
          res_id: args.res_id,
          mimetype: args.mimetype || "application/octet-stream",
        }),
      };
    },
  );

  add(
    "attachments_download",
    { attachment_id: z.number().int() },
    async (args, { client, runtime }) => {
      const records = await client.read<{ datas?: string | false }>(
        "ir.attachment",
        [args.attachment_id],
        ["datas"],
      );
      const data = records[0]?.datas;
      if (!data) return { error: "attachment_has_no_content", id: args.attachment_id };
      const content = binary(data);
      if (!content.length) return { error: "attachment_has_no_content", id: args.attachment_id };
      const metadata = await client.read<{ name?: string | false; mimetype?: string | false }>(
        "ir.attachment",
        [args.attachment_id],
        ["name", "mimetype"],
      );
      const name = metadata[0]?.name || "attachment";
      const mimetype = metadata[0]?.mimetype || "application/octet-stream";
      const receipt = await deliverArtifact(
        content,
        {
          source: { tool: "attachments_download", model: "ir.attachment" },
          filename: name,
          mimetype,
        },
        runtime,
      );
      return { ...receipt, id: args.attachment_id, name, mimetype };
    },
  );
}
