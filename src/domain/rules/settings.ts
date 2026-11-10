import { z } from "zod"
import { RuleSeveritySchema, ruleSetting } from "@/machine/contract"
import type { RuleSettings } from "@/machine/contract"
import { RULES, ruleById } from "./rules"
import type { AnyRule } from "./stages"

/** At most this many rules set by a project. */
const MAX_RULE_SETTINGS = 200

/**
 * A rule's limit as a project sets it: a number within the rule's range, for a rule with a limit;
 * none, for a rule without.
 */
export function ruleLimitSchema(rule: Pick<AnyRule, "label" | "limit">) {
  const { label, limit } = rule
  if (!limit) return z.undefined({ error: `${label} has no limit.` })
  const { unit, min, max } = limit
  const range = `${label} must be from ${min} to ${max.toLocaleString("en-US")} ${unit}.`
  return z
    .number({ error: `${label} is required.` })
    .min(min, range)
    .max(max, range)
}

/**
 * How a project reports its rules, and their limits, by rule id: only the configurable rules it
 * sets otherwise than they are by default. Settings of rules this app does not know are kept as
 * they are, and neither tested nor shown.
 */
export const RuleSettingsSchema = z
  .record(
    z.string().regex(/^[a-z0-9/-]{1,64}$/),
    z.strictObject({
      severity: RuleSeveritySchema,
      limit: z.number().optional(),
      parameters: z.record(z.string(), z.number()).optional(),
    })
  )
  .superRefine((settings, context) => {
    const entries = Object.entries(settings)
    if (entries.length > MAX_RULE_SETTINGS) {
      context.addIssue({
        code: "custom",
        message: `A project sets at most ${MAX_RULE_SETTINGS} rules.`,
      })
      return
    }
    for (const [id, setting] of entries) {
      const rule = ruleById(id)
      if (!rule) continue
      if (!rule.configurable) {
        context.addIssue({
          code: "custom",
          message: `${rule.label} is not a setting.`,
          path: [id],
        })
        continue
      }
      const limit = ruleLimitSchema(rule).safeParse(setting.limit)
      for (const issue of limit.error?.issues ?? [])
        context.addIssue({
          code: "custom",
          message: issue.message,
          path: [id, "limit"],
        })
      const parameters = rule.parameters ?? []
      const values = setting.parameters ?? {}
      for (const parameter of parameters) {
        const value = Object.hasOwn(values, parameter.id)
          ? values[parameter.id]
          : undefined
        if (value === undefined) {
          context.addIssue({
            code: "custom",
            message: `${parameter.label} is required.`,
            path: [id, "parameters", parameter.id],
          })
        } else if (value < parameter.min || value > parameter.max) {
          context.addIssue({
            code: "custom",
            message: `${parameter.label} must be from ${parameter.min} to ${parameter.max.toLocaleString("en-US")} ${parameter.unit}.`,
            path: [id, "parameters", parameter.id],
          })
        }
      }
      for (const key of Object.keys(values))
        if (!parameters.some((parameter) => parameter.id === key))
          context.addIssue({
            code: "custom",
            message: `${key} is not a setting of ${rule.label}.`,
            path: [id, "parameters", key],
          })
    }
  })

/** A configurable rule's numeric parameters, with defaults filled in. */
export function ruleParameters(
  rule: Pick<AnyRule, "parameters">,
  setting: RuleSettings[string] | undefined
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    (rule.parameters ?? []).map((parameter) => [
      parameter.id,
      setting?.parameters?.[parameter.id] ?? parameter.default,
    ])
  )
}

/**
 * Settings as the settings form edits them: every configurable rule, in list order, as the
 * project reports it and with its limit for a rule with one, then the settings of rules this app
 * does not know, as they are.
 */
export function settingsForm(settings: RuleSettings): RuleSettings {
  return Object.fromEntries([
    ...RULES.filter((rule) => rule.configurable).map((rule) => {
      const { severity, limit } = ruleSetting(rule, settings)
      const configured = Object.hasOwn(settings, rule.id)
        ? settings[rule.id]
        : undefined
      const parameters = rule.parameters?.length
        ? Object.fromEntries(
            rule.parameters.map((parameter) => [
              parameter.id,
              configured?.parameters?.[parameter.id] ?? parameter.default,
            ])
          )
        : undefined
      return [
        rule.id,
        {
          severity,
          ...(rule.limit && { limit }),
          ...(parameters && { parameters }),
        },
      ]
    }),
    ...Object.entries(settings).filter(([unknownId]) => !ruleById(unknownId)),
  ])
}

/**
 * Settings as a project saves them: without the rules it sets as they are by default, so a project
 * follows the rules' defaults where it sets nothing.
 */
export function savedRuleSettings(settings: RuleSettings): RuleSettings {
  return Object.fromEntries(
    Object.entries(settings).filter(([id, setting]) => {
      const rule = ruleById(id)
      return (
        !rule ||
        setting.severity !== rule.severity ||
        setting.limit !== rule.limit?.default ||
        rule.parameters?.some(
          (parameter) =>
            setting.parameters?.[parameter.id] !== parameter.default
        ) ||
        Object.keys(setting.parameters ?? {}).some(
          (parameterId) =>
            !rule.parameters?.some((parameter) => parameter.id === parameterId)
        )
      )
    })
  )
}

/** Whether two projects' settings report every rule alike, at the same limits, once saved. */
export function sameRuleSettings(a: RuleSettings, b: RuleSettings) {
  const savedA = savedRuleSettings(a)
  const savedB = savedRuleSettings(b)
  const ids = Object.keys(savedA)
  return (
    ids.length === Object.keys(savedB).length &&
    ids.every(
      (id) =>
        Object.hasOwn(savedB, id) &&
        savedA[id].severity === savedB[id].severity &&
        savedA[id].limit === savedB[id].limit &&
        JSON.stringify(savedA[id].parameters ?? {}) ===
          JSON.stringify(savedB[id].parameters ?? {})
    )
  )
}
