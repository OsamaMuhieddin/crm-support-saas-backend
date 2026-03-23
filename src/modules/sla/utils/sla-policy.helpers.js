import { TICKET_PRIORITY_VALUES } from '../../../constants/ticket-priority.js';

export const SLA_POLICY_PRIORITY_VALUES = TICKET_PRIORITY_VALUES;

const ACTIVE_RULE_FIELDS = Object.freeze([
  'firstResponseMinutes',
  'resolutionMinutes',
]);

const ALLOWED_RULE_FIELDS = Object.freeze([
  ...ACTIVE_RULE_FIELDS,
  'nextResponseMinutes',
]);

const normalizeNullableMinutes = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numberValue = Number(value);
  return Number.isInteger(numberValue) ? numberValue : value;
};

export const normalizeSlaRule = (rule = {}) => ({
  firstResponseMinutes: normalizeNullableMinutes(rule.firstResponseMinutes),
  resolutionMinutes: normalizeNullableMinutes(rule.resolutionMinutes),
  nextResponseMinutes: null,
});

export const normalizeRulesByPriority = (rulesByPriority = {}) =>
  Object.fromEntries(
    SLA_POLICY_PRIORITY_VALUES.map((priority) => [
      priority,
      normalizeSlaRule(rulesByPriority?.[priority] || {}),
    ])
  );

export const normalizeProvidedRulesByPriority = (rulesByPriority = {}) =>
  Object.fromEntries(
    Object.keys(rulesByPriority || {})
      .filter((priority) => SLA_POLICY_PRIORITY_VALUES.includes(priority))
      .map((priority) => [
        priority,
        normalizeSlaRule(rulesByPriority[priority] || {}),
      ])
  );

export const buildActiveSlaRuleView = (rule = {}) => ({
  firstResponseMinutes:
    (rule?.firstResponseMinutes ?? rule?.firstResponseMinutes === 0)
      ? Number(rule.firstResponseMinutes)
      : null,
  resolutionMinutes:
    (rule?.resolutionMinutes ?? rule?.resolutionMinutes === 0)
      ? Number(rule.resolutionMinutes)
      : null,
});

export const buildRulesByPriorityView = (rulesByPriority = {}) =>
  Object.fromEntries(
    SLA_POLICY_PRIORITY_VALUES.map((priority) => [
      priority,
      buildActiveSlaRuleView(rulesByPriority?.[priority] || {}),
    ])
  );

export const getSlaRuleForPriority = ({ policy, priority }) =>
  buildActiveSlaRuleView(policy?.rulesByPriority?.[priority] || {});

export const resolveSlaSelection = ({ mailbox, workspace }) => {
  if (mailbox?.slaPolicyId) {
    return {
      policyId: String(mailbox.slaPolicyId),
      source: 'mailbox',
    };
  }

  if (workspace?.defaultSlaPolicyId) {
    return {
      policyId: String(workspace.defaultSlaPolicyId),
      source: 'workspace_default',
    };
  }

  return {
    policyId: null,
    source: null,
  };
};

export const collectSlaPolicyRulesIssues = (
  rulesByPriority,
  { requireAtLeastOneRule = true } = {}
) => {
  const issues = [];

  if (
    !rulesByPriority ||
    typeof rulesByPriority !== 'object' ||
    Array.isArray(rulesByPriority)
  ) {
    return [
      {
        field: 'rulesByPriority',
        messageKey: 'errors.validation.invalid',
      },
    ];
  }

  const providedPriorities = Object.keys(rulesByPriority);
  let hasAnyConfiguredRule = false;

  for (const priority of providedPriorities) {
    if (!SLA_POLICY_PRIORITY_VALUES.includes(priority)) {
      issues.push({
        field: `rulesByPriority.${priority}`,
        messageKey: 'errors.validation.unknownField',
      });
      continue;
    }

    const rule = rulesByPriority[priority];
    const ruleField = `rulesByPriority.${priority}`;

    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      issues.push({
        field: ruleField,
        messageKey: 'errors.validation.invalid',
      });
      continue;
    }

    for (const field of Object.keys(rule)) {
      if (!ALLOWED_RULE_FIELDS.includes(field)) {
        issues.push({
          field: `${ruleField}.${field}`,
          messageKey: 'errors.validation.unknownField',
        });
        continue;
      }

      if (!ACTIVE_RULE_FIELDS.includes(field)) {
        issues.push({
          field: `${ruleField}.${field}`,
          messageKey: 'errors.validation.unknownField',
        });
      }
    }

    let hasConfiguredRuleForPriority = false;

    for (const field of ACTIVE_RULE_FIELDS) {
      const value = rule[field];

      if (value === undefined || value === null || value === '') {
        continue;
      }

      const numberValue = Number(value);

      if (!Number.isInteger(numberValue) || numberValue < 0) {
        issues.push({
          field: `${ruleField}.${field}`,
          messageKey: 'errors.validation.invalidNumber',
        });
        continue;
      }

      hasConfiguredRuleForPriority = true;
      hasAnyConfiguredRule = true;
    }

    if (!hasConfiguredRuleForPriority) {
      issues.push({
        field: ruleField,
        messageKey: 'errors.validation.atLeastOneRuleRequired',
      });
    }
  }

  if (requireAtLeastOneRule && !hasAnyConfiguredRule) {
    issues.push({
      field: 'rulesByPriority',
      messageKey: 'errors.validation.atLeastOneRuleRequired',
    });
  }

  return issues;
};
