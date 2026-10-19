# Dynamic Odoo properties

Read this before changing a field whose metadata type is `properties`. Do not
confuse those values with the general schema-discovery guide at `base/properties.md`.

Property writes can replace the field's full set of values: omitted keys may be
cleared. Sending only the changed key through `record_update` is not a safe partial
update. Read representation can include metadata, labels and relation display values;
it is not necessarily the object accepted for writing.

Common examples are `crm.lead.lead_properties` with definitions on `crm.team`, and
`project.task.task_properties` with definitions on `project.project`. Discover this
target's actual fields and parent definitions before relying on those examples.
Changing a shared definition can affect every record using it and is distinct from
changing one record's value.

For a request to change one value:

1. Inspect the field type, current complete property values and applicable definitions
   through permitted metadata/record reads. Preserve unknown and false-valued keys.
2. Establish the supported write format for this version and property types, including
   relation values. Do not pass the metadata-rich read array back unchanged.
3. Explain the replacement and concurrent-edit risk. This MCP does not expose the
   predecessor's `client.properties.*` helpers, an atomic merge, or conditional writes.
   Do not invent a helper or call read-merge-write atomic/safe against concurrent edits.
4. Proceed only with a supported full-value operation within the authorized scope
   and acceptable concurrency conditions. If a partial change cannot be made reliably
   with these interfaces, report that limitation before writing. Verify all preserved
   values as well as the changed one if an operation is performed.

Do not modify a parent definition, create a server action or change Odoo configuration
to work around the missing partial-update interface. A normal record mutation request
does not authorize those broader changes.
