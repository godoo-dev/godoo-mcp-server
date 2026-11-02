/** Request-local friendly names over the public definition-aware Odoo client. */
import {
  createPropertiesScope,
  type OdooClient,
  OdooValidationError,
  PropertiesBindingError,
  type PropertiesClient,
} from "@godoo-dev/client";
import { PublicError } from "./errors.ts";

export type PropertyObject = Record<string, unknown>;
const context = { lang: "en_US" };
function invalid(message: string): never {
  throw new PublicError(message, "invalid_properties");
}
function changed(): never {
  return invalid(
    "Property definitions or values are invalid or changed; rediscover properties, check all current values and the definition parent, then try again.",
  );
}
const object = (value: unknown): value is PropertyObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const positiveId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const kinds = new Set([
  "char",
  "integer",
  "float",
  "boolean",
  "date",
  "datetime",
  "selection",
  "tags",
  "many2one",
  "many2many",
]);

async function checked<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PropertiesBindingError || error instanceof OdooValidationError) changed();
    throw error;
  }
}

// Full Unicode case folding preserves the established Python naming contract.
// Only characters whose case fold differs from lowercase require overrides.
const caseFoldExceptions: Record<string, string> = JSON.parse(
  '{"µ":"μ","ß":"ss","ŉ":"ʼn","ſ":"s","ǰ":"ǰ","ͅ":"ι","ΐ":"ΐ","ΰ":"ΰ","ς":"σ","ϐ":"β","ϑ":"θ","ϕ":"φ","ϖ":"π","ϰ":"κ","ϱ":"ρ","ϵ":"ε","և":"եւ","Ꭰ":"Ꭰ","Ꭱ":"Ꭱ","Ꭲ":"Ꭲ","Ꭳ":"Ꭳ","Ꭴ":"Ꭴ","Ꭵ":"Ꭵ","Ꭶ":"Ꭶ","Ꭷ":"Ꭷ","Ꭸ":"Ꭸ","Ꭹ":"Ꭹ","Ꭺ":"Ꭺ","Ꭻ":"Ꭻ","Ꭼ":"Ꭼ","Ꭽ":"Ꭽ","Ꭾ":"Ꭾ","Ꭿ":"Ꭿ","Ꮀ":"Ꮀ","Ꮁ":"Ꮁ","Ꮂ":"Ꮂ","Ꮃ":"Ꮃ","Ꮄ":"Ꮄ","Ꮅ":"Ꮅ","Ꮆ":"Ꮆ","Ꮇ":"Ꮇ","Ꮈ":"Ꮈ","Ꮉ":"Ꮉ","Ꮊ":"Ꮊ","Ꮋ":"Ꮋ","Ꮌ":"Ꮌ","Ꮍ":"Ꮍ","Ꮎ":"Ꮎ","Ꮏ":"Ꮏ","Ꮐ":"Ꮐ","Ꮑ":"Ꮑ","Ꮒ":"Ꮒ","Ꮓ":"Ꮓ","Ꮔ":"Ꮔ","Ꮕ":"Ꮕ","Ꮖ":"Ꮖ","Ꮗ":"Ꮗ","Ꮘ":"Ꮘ","Ꮙ":"Ꮙ","Ꮚ":"Ꮚ","Ꮛ":"Ꮛ","Ꮜ":"Ꮜ","Ꮝ":"Ꮝ","Ꮞ":"Ꮞ","Ꮟ":"Ꮟ","Ꮠ":"Ꮠ","Ꮡ":"Ꮡ","Ꮢ":"Ꮢ","Ꮣ":"Ꮣ","Ꮤ":"Ꮤ","Ꮥ":"Ꮥ","Ꮦ":"Ꮦ","Ꮧ":"Ꮧ","Ꮨ":"Ꮨ","Ꮩ":"Ꮩ","Ꮪ":"Ꮪ","Ꮫ":"Ꮫ","Ꮬ":"Ꮬ","Ꮭ":"Ꮭ","Ꮮ":"Ꮮ","Ꮯ":"Ꮯ","Ꮰ":"Ꮰ","Ꮱ":"Ꮱ","Ꮲ":"Ꮲ","Ꮳ":"Ꮳ","Ꮴ":"Ꮴ","Ꮵ":"Ꮵ","Ꮶ":"Ꮶ","Ꮷ":"Ꮷ","Ꮸ":"Ꮸ","Ꮹ":"Ꮹ","Ꮺ":"Ꮺ","Ꮻ":"Ꮻ","Ꮼ":"Ꮼ","Ꮽ":"Ꮽ","Ꮾ":"Ꮾ","Ꮿ":"Ꮿ","Ᏸ":"Ᏸ","Ᏹ":"Ᏹ","Ᏺ":"Ᏺ","Ᏻ":"Ᏻ","Ᏼ":"Ᏼ","Ᏽ":"Ᏽ","ᏸ":"Ᏸ","ᏹ":"Ᏹ","ᏺ":"Ᏺ","ᏻ":"Ᏻ","ᏼ":"Ᏼ","ᏽ":"Ᏽ","ᲀ":"в","ᲁ":"д","ᲂ":"о","ᲃ":"с","ᲄ":"т","ᲅ":"т","ᲆ":"ъ","ᲇ":"ѣ","ᲈ":"ꙋ","ẖ":"ẖ","ẗ":"ẗ","ẘ":"ẘ","ẙ":"ẙ","ẚ":"aʾ","ẛ":"ṡ","ẞ":"ss","ὐ":"ὐ","ὒ":"ὒ","ὔ":"ὔ","ὖ":"ὖ","ᾀ":"ἀι","ᾁ":"ἁι","ᾂ":"ἂι","ᾃ":"ἃι","ᾄ":"ἄι","ᾅ":"ἅι","ᾆ":"ἆι","ᾇ":"ἇι","ᾈ":"ἀι","ᾉ":"ἁι","ᾊ":"ἂι","ᾋ":"ἃι","ᾌ":"ἄι","ᾍ":"ἅι","ᾎ":"ἆι","ᾏ":"ἇι","ᾐ":"ἠι","ᾑ":"ἡι","ᾒ":"ἢι","ᾓ":"ἣι","ᾔ":"ἤι","ᾕ":"ἥι","ᾖ":"ἦι","ᾗ":"ἧι","ᾘ":"ἠι","ᾙ":"ἡι","ᾚ":"ἢι","ᾛ":"ἣι","ᾜ":"ἤι","ᾝ":"ἥι","ᾞ":"ἦι","ᾟ":"ἧι","ᾠ":"ὠι","ᾡ":"ὡι","ᾢ":"ὢι","ᾣ":"ὣι","ᾤ":"ὤι","ᾥ":"ὥι","ᾦ":"ὦι","ᾧ":"ὧι","ᾨ":"ὠι","ᾩ":"ὡι","ᾪ":"ὢι","ᾫ":"ὣι","ᾬ":"ὤι","ᾭ":"ὥι","ᾮ":"ὦι","ᾯ":"ὧι","ᾲ":"ὰι","ᾳ":"αι","ᾴ":"άι","ᾶ":"ᾶ","ᾷ":"ᾶι","ᾼ":"αι","ι":"ι","ῂ":"ὴι","ῃ":"ηι","ῄ":"ήι","ῆ":"ῆ","ῇ":"ῆι","ῌ":"ηι","ῒ":"ῒ","ΐ":"ΐ","ῖ":"ῖ","ῗ":"ῗ","ῢ":"ῢ","ΰ":"ΰ","ῤ":"ῤ","ῦ":"ῦ","ῧ":"ῧ","ῲ":"ὼι","ῳ":"ωι","ῴ":"ώι","ῶ":"ῶ","ῷ":"ῶι","ῼ":"ωι","ꭰ":"Ꭰ","ꭱ":"Ꭱ","ꭲ":"Ꭲ","ꭳ":"Ꭳ","ꭴ":"Ꭴ","ꭵ":"Ꭵ","ꭶ":"Ꭶ","ꭷ":"Ꭷ","ꭸ":"Ꭸ","ꭹ":"Ꭹ","ꭺ":"Ꭺ","ꭻ":"Ꭻ","ꭼ":"Ꭼ","ꭽ":"Ꭽ","ꭾ":"Ꭾ","ꭿ":"Ꭿ","ꮀ":"Ꮀ","ꮁ":"Ꮁ","ꮂ":"Ꮂ","ꮃ":"Ꮃ","ꮄ":"Ꮄ","ꮅ":"Ꮅ","ꮆ":"Ꮆ","ꮇ":"Ꮇ","ꮈ":"Ꮈ","ꮉ":"Ꮉ","ꮊ":"Ꮊ","ꮋ":"Ꮋ","ꮌ":"Ꮌ","ꮍ":"Ꮍ","ꮎ":"Ꮎ","ꮏ":"Ꮏ","ꮐ":"Ꮐ","ꮑ":"Ꮑ","ꮒ":"Ꮒ","ꮓ":"Ꮓ","ꮔ":"Ꮔ","ꮕ":"Ꮕ","ꮖ":"Ꮖ","ꮗ":"Ꮗ","ꮘ":"Ꮘ","ꮙ":"Ꮙ","ꮚ":"Ꮚ","ꮛ":"Ꮛ","ꮜ":"Ꮜ","ꮝ":"Ꮝ","ꮞ":"Ꮞ","ꮟ":"Ꮟ","ꮠ":"Ꮠ","ꮡ":"Ꮡ","ꮢ":"Ꮢ","ꮣ":"Ꮣ","ꮤ":"Ꮤ","ꮥ":"Ꮥ","ꮦ":"Ꮦ","ꮧ":"Ꮧ","ꮨ":"Ꮨ","ꮩ":"Ꮩ","ꮪ":"Ꮪ","ꮫ":"Ꮫ","ꮬ":"Ꮬ","ꮭ":"Ꮭ","ꮮ":"Ꮮ","ꮯ":"Ꮯ","ꮰ":"Ꮰ","ꮱ":"Ꮱ","ꮲ":"Ꮲ","ꮳ":"Ꮳ","ꮴ":"Ꮴ","ꮵ":"Ꮵ","ꮶ":"Ꮶ","ꮷ":"Ꮷ","ꮸ":"Ꮸ","ꮹ":"Ꮹ","ꮺ":"Ꮺ","ꮻ":"Ꮻ","ꮼ":"Ꮼ","ꮽ":"Ꮽ","ꮾ":"Ꮾ","ꮿ":"Ꮿ","ﬀ":"ff","ﬁ":"fi","ﬂ":"fl","ﬃ":"ffi","ﬄ":"ffl","ﬅ":"st","ﬆ":"st","ﬓ":"մն","ﬔ":"մե","ﬕ":"մի","ﬖ":"վն","ﬗ":"մխ"}',
);
function alias(label: string): string {
  return Array.from(
    label.normalize("NFC"),
    (letter) => caseFoldExceptions[letter] ?? letter.toLowerCase(),
  )
    .join("")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

interface Definition {
  id: string;
  label: string;
  kind: string;
  comodel?: string;
  options: Map<string, { id: string; label: string }>;
}

class Names {
  readonly definitions = new Map<string, Definition>();
  readonly separators = new Set<string>();
  constructor(raw: PropertyObject[]) {
    const ids = new Set<string>();
    for (const definition of raw) {
      if (
        !nonempty(definition.name) ||
        typeof definition.string !== "string" ||
        !nonempty(definition.type) ||
        ids.has(definition.name)
      )
        changed();
      ids.add(definition.name);
      if (definition.type === "separator") {
        this.separators.add(definition.name);
        continue;
      }
      const name = alias(definition.string);
      if (!name || this.definitions.has(name))
        invalid(
          "Property labels produce empty or duplicate friendly names; rename the labels in Odoo and rediscover properties.",
        );
      const options = new Map<string, { id: string; label: string }>();
      if (definition.type === "selection" || definition.type === "tags") {
        const entries = definition[definition.type] ?? [];
        if (!Array.isArray(entries)) changed();
        const optionIds = new Set<string>();
        for (const item of entries) {
          if (
            !Array.isArray(item) ||
            item.length !== (definition.type === "tags" ? 3 : 2) ||
            !nonempty(item[0]) ||
            typeof item[1] !== "string" ||
            optionIds.has(item[0]) ||
            (definition.type === "tags" && !Number.isInteger(item[2]))
          )
            changed();
          optionIds.add(item[0]);
          const name = alias(item[1]);
          if (!name || options.has(name))
            invalid(
              "Option labels produce empty or duplicate friendly names; rename the choices in Odoo and rediscover properties.",
            );
          options.set(name, { id: item[0], label: item[1] });
        }
      }
      if (definition.comodel && typeof definition.comodel !== "string") changed();
      if (["many2one", "many2many"].includes(definition.type) && !nonempty(definition.comodel))
        changed();
      this.definitions.set(name, {
        id: definition.name,
        label: definition.string,
        kind: definition.type,
        ...(nonempty(definition.comodel) ? { comodel: definition.comodel } : {}),
        options,
      });
    }
  }
  definition(name: string): Definition {
    const definition = this.definitions.get(name);
    if (!definition) invalid("Unknown property name; rediscover properties after label changes.");
    return definition;
  }
  describe(): PropertyObject[] {
    return [...this.definitions].map(([name, definition]) => ({
      name,
      label: definition.label,
      type: definition.kind,
      ...(definition.comodel === undefined ? {} : { comodel: definition.comodel }),
      ...(["selection", "tags"].includes(definition.kind)
        ? {
            values: [...definition.options].map(([name, option]) => ({
              name,
              label: option.label,
            })),
          }
        : {}),
    }));
  }
  encode(name: string, value: unknown): unknown {
    const definition = this.definition(name);
    if (!kinds.has(definition.kind)) changed();
    if (value === false && definition.kind !== "boolean")
      invalid("False is only valid for boolean properties; use null to clear.");
    if (value === null) return ["tags", "many2many"].includes(definition.kind) ? [] : false;
    if (definition.kind === "selection" || definition.kind === "tags") {
      const choices = definition.kind === "tags" ? value : [value];
      if (
        !Array.isArray(choices) ||
        choices.some((choice) => typeof choice !== "string" || !definition.options.has(choice))
      )
        invalid("Unknown or malformed property choice; use discovered friendly values.");
      const encoded = choices.map((choice) => definition.options.get(choice)?.id);
      return definition.kind === "tags" ? encoded : encoded[0];
    }
    return scalar(definition, value, false);
  }
  decode(name: string, value: unknown): unknown {
    const definition = this.definition(name);
    if (!kinds.has(definition.kind)) changed();
    if (value === null && definition.kind === "boolean") return false;
    if (value === null || (value === false && definition.kind !== "boolean"))
      return ["tags", "many2many"].includes(definition.kind) ? [] : null;
    if (definition.kind === "selection" || definition.kind === "tags") {
      const reverse = new Map([...definition.options].map(([name, option]) => [option.id, name]));
      const values = definition.kind === "tags" ? value : [value];
      if (
        !Array.isArray(values) ||
        values.some((entry) => typeof entry !== "string" || !reverse.has(entry))
      )
        changed();
      const decoded = values.map((entry) => reverse.get(entry));
      return definition.kind === "tags" ? decoded : decoded[0];
    }
    return scalar(definition, value, true);
  }
}

function validCalendarDate(value: string): boolean {
  const calendar =
    /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value) ?? /^(\d{4})(\d{2})(\d{2})$/u.exec(value);
  if (calendar) {
    const [, year, month, day] = calendar.map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }
  const week = /^(\d{4})(-?)W(\d{2})(?:\2([1-7]))?$/u.exec(value);
  if (!week) return false;
  const year = Number(week[1]);
  const number = Number(week[3]);
  if (year < 1 || number < 1 || number > 53) return false;
  // ISO week 53 exists only when Jan 1 is Thursday, or Wednesday in a leap year.
  const jan1 = new Date(0);
  jan1.setUTCFullYear(year, 0, 1);
  return (
    number < 53 ||
    jan1.getUTCDay() === 4 ||
    (jan1.getUTCDay() === 3 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))
  );
}

function validTime(value: string): boolean {
  const time = /^(\d{2})(?:(:?)(\d{2})(?:\2(\d{2}))?)?(?:[.,]\d+)?$/u.exec(value);
  return !!time && Number(time[1]) < 24 && Number(time[3] ?? 0) < 60 && Number(time[4] ?? 0) < 60;
}

function validDate(value: string, datetime = false): boolean {
  if (!datetime) return validCalendarDate(value);
  const parts =
    /^(\d{4}-\d{2}-\d{2}|\d{8}|\d{4}-W\d{2}-[1-7]|\d{4}W\d{2}[1-7]|\d{4}-W\d{2}|\d{4}W\d{2})(?:.(.+))?$/u.exec(
      value,
    );
  if (!parts || !validCalendarDate(parts[1])) return false;
  if (parts[2] === undefined) return true;
  const time = /^(.*?)(Z|[+-].+)?$/u.exec(parts[2]);
  return (
    !!time &&
    validTime(time[1]) &&
    (time[2] === undefined || time[2] === "Z" || validTime(time[2].slice(1)))
  );
}

function scalar(definition: Definition, value: unknown, reading: boolean): unknown {
  switch (definition.kind) {
    case "char":
      if (typeof value === "string") return value;
      break;
    case "integer":
      if (typeof value === "number" && Number.isSafeInteger(value)) return value;
      break;
    case "float":
      if (typeof value === "number" && Number.isFinite(value)) return value;
      break;
    case "boolean":
      if (typeof value === "boolean") return value;
      break;
    case "date":
    case "datetime":
      if (typeof value === "string" && validDate(value, definition.kind === "datetime"))
        return value;
      break;
    case "many2one": {
      const id =
        reading &&
        Array.isArray(value) &&
        value.length === 2 &&
        (typeof value[1] === "string" || value[1] === null || value[1] === false)
          ? value[0]
          : value;
      if (positiveId(id)) return id;
      break;
    }
    case "many2many": {
      if (Array.isArray(value)) {
        const ids = value.map((item) =>
          reading &&
          Array.isArray(item) &&
          item.length === 2 &&
          (typeof item[1] === "string" || item[1] === null || item[1] === false)
            ? item[0]
            : item,
        );
        if (ids.every(positiveId)) return ids;
      }
      break;
    }
  }
  return changed();
}

async function metadata(client: OdooClient, model: string): Promise<PropertyObject> {
  const result = await client.call(model, "fields_get", [], { context });
  if (!object(result)) changed();
  return result;
}
function containerInfo(metadata: PropertyObject, field: string): PropertyObject {
  const info = metadata[field];
  if (!object(info) || info.type !== "properties")
    invalid("Unknown or inaccessible properties container; discover model fields first.");
  return info;
}
function path(value: string, leaf = false): [string, string | undefined] {
  const parts = value.split(".");
  if (
    !(leaf ? parts.length === 3 : parts.length === 2 || parts.length === 3) ||
    parts[0] !== "properties" ||
    parts.some((part) => !part)
  )
    invalid("Use properties.<container>.<name>, or properties.<container> for reads.");
  return [parts[1], parts[2]];
}
function relationId(value: unknown): number {
  const id = Array.isArray(value) ? value[0] : value;
  if (!positiveId(id))
    invalid(
      "A positive definition parent is required; rediscover properties after setting the parent.",
    );
  return id;
}
async function namesFor(
  client: OdooClient,
  model: string,
  container: string,
  parentId: number,
): Promise<Names> {
  // Scope discovery reads only the parent's definitions. Odoo also represents
  // empty definitions as false/null; normalize that representation at this seam.
  const scopeClient: PropertiesClient = {
    call: client.call.bind(client),
    write: client.write.bind(client),
    async read<T extends object = PropertyObject>(
      target: string,
      ids: number | number[],
      fields?: string[],
      readContext?: PropertyObject,
    ): Promise<T[]> {
      const rows = await client.read<PropertyObject>(target, ids, fields, readContext);
      return rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([field, value]) => [
            field,
            field !== "id" && (value === false || value === null) ? [] : value,
          ]),
        ),
      ) as T[];
    },
  };
  const scope = await createPropertiesScope(scopeClient, model, container, { parentId, context });
  return new Names(scope.describe().definitions);
}
function validateCurrent(names: Names, raw: unknown): PropertyObject {
  if (raw === null || raw === false) raw = [];
  if (!Array.isArray(raw)) changed();
  const entries = new Map<string, PropertyObject>();
  const seen = new Set<string>();
  for (const item of raw) {
    if (!object(item) || !nonempty(item.name) || seen.has(item.name)) changed();
    seen.add(item.name);
    if (item.type === "separator") {
      if (!names.separators.has(item.name)) changed();
      continue;
    }
    entries.set(item.name, item);
  }
  const result: PropertyObject = {};
  for (const [name, definition] of names.definitions) {
    const item = entries.get(definition.id);
    if (
      !item ||
      !Object.hasOwn(item, "value") ||
      item.type !== definition.kind ||
      (item.comodel || undefined) !== definition.comodel
    )
      changed();
    result[name] = names.decode(name, item.value);
    entries.delete(definition.id);
  }
  if (entries.size) changed();
  return result;
}
async function recordContainer(
  client: OdooClient,
  model: string,
  id: number,
  container: string,
  info: PropertyObject,
  ordinary: string[] = [],
): Promise<{ names: Names; values: PropertyObject; row: PropertyObject }> {
  if (!nonempty(info.definition_record)) changed();
  const rows = await client.read(
    model,
    [id],
    [...new Set([...ordinary, container, info.definition_record])],
    context,
  );
  const row = rows[0];
  if (!row || row.id !== id) changed();
  const names = await namesFor(client, model, container, relationId(row[info.definition_record]));
  return { names, values: validateCurrent(names, row[container]), row };
}

export async function discover(
  client: OdooClient,
  model: string,
  recordId?: number | null,
  propertyField?: string | null,
  parentId?: number | null,
): Promise<PropertyObject> {
  const recordScope = recordId != null && propertyField == null && parentId == null;
  const parentScope = recordId == null && propertyField != null && parentId != null;
  if (!(recordScope || parentScope) || !positiveId(recordScope ? recordId : parentId))
    invalid("Supply a positive record_id OR property_field and a positive parent_id.");
  return checked(async () => {
    const fields = await metadata(client, model);
    if (parentScope) {
      containerInfo(fields, propertyField as string);
      return {
        [propertyField as string]: (
          await namesFor(client, model, propertyField as string, parentId as number)
        ).describe(),
      };
    }
    const result: PropertyObject = {};
    for (const [field, info] of Object.entries(fields)) {
      if (object(info) && info.type === "properties")
        result[field] = (
          await recordContainer(client, model, recordId as number, field, info)
        ).names.describe();
    }
    if (!Object.keys(result).length)
      await client.read(model, [recordId as number], ["id"], context);
    return result;
  });
}

export async function readProperties(
  client: OdooClient,
  model: string,
  ids: number[],
  fields: string[],
): Promise<PropertyObject[]> {
  const requested = new Map<string, Array<string | undefined>>();
  const ordinary: string[] = [];
  for (const field of fields) {
    if (!field.startsWith("properties.")) ordinary.push(field);
    else {
      const [container, name] = path(field);
      requested.set(container, [...(requested.get(container) ?? []), name]);
    }
  }
  if (!requested.size) return client.read(model, ids, fields);
  if (!ids.length) return [];
  return checked(async () => {
    const metadataValue = await metadata(client, model);
    if (
      ordinary.some(
        (field) => object(metadataValue[field]) && metadataValue[field].type === "properties",
      )
    )
      invalid("Use friendly properties paths for containers in a friendly read.");
    const result = new Map<number, PropertyObject>();
    for (const [container, selected] of requested) {
      const info = containerInfo(metadataValue, container);
      for (const id of ids) {
        const { names, values, row } = await recordContainer(
          client,
          model,
          id,
          container,
          info,
          ordinary,
        );
        for (const name of selected) if (name !== undefined) names.definition(name);
        const projected = Object.fromEntries(
          Object.entries(values).filter(
            ([name]) => selected.includes(undefined) || selected.includes(name),
          ),
        );
        const entry =
          result.get(id) ??
          Object.fromEntries(
            ["id", ...ordinary].map((field) => [field, structuredClone(row[field])]),
          );
        if (!object(entry.properties)) entry.properties = {};
        (entry.properties as PropertyObject)[container] = projected;
        result.set(id, entry);
      }
    }
    return ids.map((id) => result.get(id) as PropertyObject);
  });
}

function patches(
  properties: unknown,
  values: unknown,
  message: string,
): asserts properties is Record<string, PropertyObject> {
  if (
    !object(properties) ||
    !Object.keys(properties).length ||
    !object(values) ||
    Object.values(properties).some((patch) => !object(patch) || !Object.keys(patch).length)
  )
    invalid(message);
}
function rejectRaw(fields: PropertyObject, values: PropertyObject): void {
  if (
    Object.keys(values).some(
      (field) => object(fields[field]) && fields[field].type === "properties",
    )
  )
    invalid("Do not mix raw properties containers with friendly property changes.");
}
function encodePatch(names: Names, patch: PropertyObject): PropertyObject {
  return Object.fromEntries(
    Object.entries(patch).map(([name, value]) => [
      names.definition(name).id,
      names.encode(name, value),
    ]),
  );
}

export async function prepareCreate(
  client: OdooClient,
  model: string,
  properties: unknown,
  values: PropertyObject,
): Promise<PropertyObject> {
  patches(properties, values, "Property creation requires nonempty property containers.");
  return checked(async () => {
    const fields = await metadata(client, model);
    rejectRaw(fields, values);
    const result = structuredClone(values);
    for (const [container, patch] of Object.entries(properties)) {
      const info = containerInfo(fields, container);
      const parentId =
        typeof info.definition_record === "string" ? values[info.definition_record] : undefined;
      if (!positiveId(parentId))
        invalid("Supply each properties container's positive definition-parent ID in values.");
      result[container] = encodePatch(await namesFor(client, model, container, parentId), patch);
    }
    return result;
  });
}

export async function prepareUpdate(
  client: OdooClient,
  model: string,
  recordId: number,
  properties: unknown,
  values: PropertyObject,
): Promise<PropertyObject> {
  if (!positiveId(recordId))
    invalid("Property updates require one positive record ID and nonempty property patches.");
  patches(
    properties,
    values,
    "Property updates require one positive record ID and nonempty property patches.",
  );
  return checked(async () => {
    const fields = await metadata(client, model);
    for (const container of Object.keys(properties)) {
      const info = containerInfo(fields, container);
      if (
        typeof info.definition_record === "string" &&
        Object.hasOwn(values, info.definition_record)
      )
        invalid("Change the definition parent separately, then rediscover properties.");
    }
    rejectRaw(fields, values);
    const result = structuredClone(values);
    for (const [container, patch] of Object.entries(properties)) {
      const { names, values: current } = await recordContainer(
        client,
        model,
        recordId,
        container,
        containerInfo(fields, container),
      );
      result[container] = { ...encodePatch(names, current), ...encodePatch(names, patch) };
    }
    return result;
  });
}

const operators: Record<string, string[]> = {
  boolean: ["=", "!="],
  integer: ["=", "!=", ">", ">=", "<", "<="],
  float: ["=", "!=", ">", ">=", "<", "<="],
  date: ["=", "!=", ">", ">=", "<", "<="],
  datetime: ["=", "!=", ">", ">=", "<", "<="],
  char: ["=", "!=", "ilike", "not ilike"],
  selection: ["=", "!=", "in", "not in"],
  many2one: ["=", "!=", "in", "not in"],
};
function predicate(names: Names, name: string, operator: unknown, value: unknown): unknown {
  const definition = names.definition(name);
  const allowed = operators[definition.kind] ?? [];
  if (typeof operator !== "string" || !allowed.includes(operator))
    invalid(
      `Unsupported operator for ${definition.kind} properties; allowed operators: ${allowed.length ? [...allowed].sort().join(", ") : "none (array property search is not supported yet)"}.`,
    );
  if (operator === "in" || operator === "not in") {
    if (!Array.isArray(value) || !value.length || value.includes(null))
      invalid("Property membership requires a nonempty list of friendly values.");
    return value.map((entry) => predicate(names, name, "=", entry));
  }
  if (value === null && operator !== "=" && operator !== "!=")
    invalid("Null is only supported with = or != for properties.");
  return names.encode(name, value);
}

export async function compileDomain(
  client: OdooClient,
  model: string,
  domain: unknown[],
): Promise<unknown[]> {
  const friendly = (item: unknown): item is unknown[] =>
    Array.isArray(item) && typeof item[0] === "string" && item[0].startsWith("properties.");
  const nested = (item: unknown): boolean =>
    Array.isArray(item) &&
    item.length === 3 &&
    ["any", "not any", "any!", "not any!"].includes(String(item[1])) &&
    contains(item[2]);
  const contains = (items: unknown): boolean =>
    Array.isArray(items) && items.some((item) => friendly(item) || nested(item));
  if (!contains(domain)) return domain;
  if (domain.some((item) => !Array.isArray(item) || item.length !== 3 || nested(item)))
    invalid("Friendly property domains require a conjunction of leaves; OR/NOT is unsupported.");
  return checked(async () => {
    const fields = await metadata(client, model);
    const scopes = new Map<string, Names>();
    const result: unknown[] = [];
    for (const item of domain as unknown[][]) {
      if (!friendly(item)) {
        result.push(structuredClone(item));
        continue;
      }
      const [container, name] = path(item[0] as string, true);
      let names = scopes.get(container);
      if (!names) {
        const info = containerInfo(fields, container);
        const leaves = (domain as unknown[][]).filter((leaf) => leaf[0] === info.definition_record);
        if (
          typeof info.definition_record !== "string" ||
          !leaves.length ||
          leaves.some((leaf) => leaf[1] !== "=" || !positiveId(leaf[2])) ||
          new Set(leaves.map((leaf) => leaf[2])).size !== 1
        )
          invalid(
            "Friendly property predicates require one positive definition-parent equality under AND for each container.",
          );
        names = await namesFor(client, model, container, leaves[0][2] as number);
        scopes.set(container, names);
      }
      result.push([
        `${container}.${names.definition(name as string).id}`,
        item[1],
        predicate(names, name as string, item[1], item[2]),
      ]);
    }
    return result;
  });
}
