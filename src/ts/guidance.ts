import dynamic from "../godoo_mcp_server/skills/base/dynamic-properties.md";
import fields from "../godoo_mcp_server/skills/base/field-types.md";
import schema from "../godoo_mcp_server/skills/base/properties.md";
import queries from "../godoo_mcp_server/skills/base/queries.md";
import changes from "../godoo_mcp_server/skills/base/record-changes.md";
import activities from "../godoo_mcp_server/skills/mail/activities.md";
import chatter from "../godoo_mcp_server/skills/mail/chatter.md";
import root from "../godoo_mcp_server/skills/SKILL.md";

export const topics = [
  ["SKILL.md", "Odoo", "Start here: select a workflow for the current Odoo target.", root],
  ["base/properties.md", "Schema discovery", "Inspect models and field metadata.", schema],
  ["base/field-types.md", "Field formats", "Relations, selections and date formats.", fields],
  ["base/queries.md", "Queries", "Bounded searches, domains and stage semantics.", queries],
  ["base/record-changes.md", "Record changes", "CRUD, relation commands and readback.", changes],
  [
    "base/dynamic-properties.md",
    "Dynamic properties",
    "Discover, read, patch and search friendly property names and choices.",
    dynamic,
  ],
  ["mail/chatter.md", "Chatter", "Messages, internal notes, recipients and mentions.", chatter],
  ["mail/activities.md", "Activities", "Type discovery, scheduling and completion.", activities],
] as const;
export const guidance = new Map<string, string>(topics.map(([path, , , text]) => [path, text]));
export function guidanceIndex() {
  return {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        type: "skill-md",
        name: "odoo",
        description: "Odoo ERP integration over MCP.",
        url: "skill://odoo/SKILL.md",
      },
    ],
    topics: topics.map(([path, title, description]) => ({
      path,
      title,
      description,
      url: `skill://odoo/${path}`,
    })),
  };
}
