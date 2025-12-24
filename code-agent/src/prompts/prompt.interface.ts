import { z } from 'zod';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface IPromptBuilder<TVariables, TOutput = any> {
    buildSystemPrompt(): string;
    buildUserPrompt(variables: TVariables): string;
    getReasoningEffort(): ReasoningEffort;
    getZodSchema(): z.ZodType<TOutput>;
}

/**
 * Converts a Zod schema to a JSON Schema object suitable for LM Studio's response_format.
 * LM Studio expects a flat schema without $schema or definitions wrappers.
 * 
 * This handles Zod v4's new internal structure where _def.type is the type name.
 */
export function zodSchemaToJsonSchema(schema: z.ZodType<any>): object {
    return convertZodToJsonSchema(schema);
}

function convertZodToJsonSchema(schema: any): any {
    // Zod v4 uses _def.type for the type name and stores shape/element directly
    const def = schema._def || schema.def;

    if (!def) {
        // Try to access 'type' directly on the schema object (Zod v4 style)
        if (schema.type) {
            return convertByType(schema.type, schema);
        }
        console.warn('[zodSchemaToJsonSchema] No _def or type found');
        return { type: 'string' };
    }

    // Zod v4: type is directly in def
    const typeName = def.type || def.typeName;

    return convertByType(typeName, { ...def, _def: def });
}

function convertByType(typeName: string, schema: any): any {
    switch (typeName) {
        case 'object': {
            // Zod v4: shape is an object with schema objects directly
            const shape = schema.shape || schema._def?.shape || {};
            const properties: Record<string, any> = {};
            const required: string[] = [];

            for (const [key, value] of Object.entries(shape)) {
                properties[key] = convertZodToJsonSchema(value);
                // In Zod v4, check if the schema has optional type
                const valueType = (value as any)?.type || (value as any)?._def?.type;
                if (valueType !== 'optional') {
                    required.push(key);
                }
            }

            return {
                type: 'object',
                properties,
                required: required.length > 0 ? required : undefined,
                additionalProperties: false
            };
        }

        case 'array': {
            // Zod v4: element contains the inner schema
            const element = schema.element || schema._def?.element;
            return {
                type: 'array',
                items: element ? convertZodToJsonSchema(element) : { type: 'string' }
            };
        }

        case 'string': {
            return { type: 'string' };
        }

        case 'number': {
            return { type: 'number' };
        }

        case 'boolean': {
            return { type: 'boolean' };
        }

        case 'enum': {
            const values = schema.values || schema._def?.values;
            return { type: 'string', enum: values };
        }

        case 'literal': {
            // Zod v4 uses `values` array, Zod v3 uses `value`
            const values = schema.values || schema._def?.values;
            const value = schema.value || schema._def?.value;
            const actualValue = values ? values[0] : value;
            return { const: actualValue };
        }

        case 'optional': {
            const innerType = schema.innerType || schema._def?.innerType;
            return innerType ? convertZodToJsonSchema(innerType) : { type: 'string' };
        }

        case 'record': {
            const valueType = schema.valueType || schema._def?.valueType;
            return {
                type: 'object',
                additionalProperties: valueType ? convertZodToJsonSchema(valueType) : {}
            };
        }

        case 'discriminatedUnion':
        case 'union': {
            const options = schema.options || schema._def?.options || [];
            const oneOf = options.map((opt: any) => convertZodToJsonSchema(opt));
            return { oneOf };
        }

        case 'any': {
            return {};
        }

        default:
            console.warn(`[zodSchemaToJsonSchema] Unhandled Zod type: ${typeName}`);
            return { type: 'string' };
    }
}
