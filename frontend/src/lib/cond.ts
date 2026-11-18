import type { Condition, FormField } from '../api/types';

export function evalCond(c: Condition | boolean | null | undefined, f: Record<string, any>): boolean {
  if (c === null || c === undefined) return false;
  if (typeof c === 'boolean') return c;
  if ('all' in c) return c.all.every((x) => evalCond(x, f));
  if ('any' in c) return c.any.some((x) => evalCond(x, f));
  const v = f[c.field];
  switch (c.op) {
    case 'eq': return v === c.value;
    case 'neq': return v !== c.value;
    case 'in': return Array.isArray(c.value) && c.value.includes(v);
    case 'notIn': return Array.isArray(c.value) && !c.value.includes(v);
    case 'set': return c.value ? !!v : !v;
    default: return false;
  }
}
export const isRequired = (x: FormField, f: Record<string, any>) => evalCond(x.required as Condition | boolean | null, f);
export const isShown = (x: FormField, f: Record<string, any>) => !x.showWhen || evalCond(x.showWhen, f);
