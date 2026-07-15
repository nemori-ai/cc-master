import {
  bindRunStoreErrorV2,
  decodeAndValidateAuthorityV2,
  operationDigestV2,
  validateCapabilityV2,
  validateExecutionV2,
  validateOperationV2,
} from './run-store-capability-v2-contract.mjs';

function mutation(operation) {
  return operation.kind !== 'read-file' && operation.kind !== 'list-directory';
}

function snapshot(observeDurability) {
  if (typeof observeDurability !== 'function') return null;
  const value = observeDurability();
  return {
    writes: value?.writes ?? 0,
    fileSyncs: value?.fileSyncs ?? 0,
    directorySyncs: value?.directorySyncs ?? 0,
  };
}

function validateCommittedEvidence(operation, execution, before, after) {
  if (!mutation(operation) || execution.outcome !== 'committed') return;
  if (
    before === null ||
    after === null ||
    after.writes <= before.writes ||
    after.fileSyncs <= before.fileSyncs ||
    after.directorySyncs <= before.directorySyncs
  ) {
    throw bindRunStoreErrorV2(
      new Error('committed mutation lacks observed write, file sync, or directory sync'),
      execution.authority_id,
      operation,
      { effect: 'unknown', retry: 'reconcile-first', code: 'RUN_STORE_RECEIPT_DURABILITY' },
    );
  }
}

export async function executeViaRunStoreCapabilityV2({
  consume,
  env,
  cwdStat,
  rawOperations,
  observeDurability,
  observeMutation,
}) {
  const authority = decodeAndValidateAuthorityV2({ env, cwdStat });
  const operations = rawOperations.map((operation) => {
    try {
      return validateOperationV2(operation, authority.grant);
    } catch (error) {
      throw bindRunStoreErrorV2(error, authority.authority_id, operation, {
        effect: 'none',
        retry: 'never',
      });
    }
  });
  let consumerInvocations = 0;
  let capabilityInvocations = 0;
  consumerInvocations += 1;
  let capability;
  try {
    capability = validateCapabilityV2(
      await consume({ env, cwdStat }),
      authority.authority_id,
      authority.grant.phase,
    );
  } catch (error) {
    throw bindRunStoreErrorV2(error, authority.authority_id, null, {
      effect: 'none',
      retry: 'never',
    });
  }
  const executions = [];
  for (const operation of operations) {
    capabilityInvocations += 1;
    const before = snapshot(observeDurability);
    try {
      const execution = validateExecutionV2(
        await capability.execute(operation),
        authority.authority_id,
        operation,
      );
      validateCommittedEvidence(operation, execution, before, snapshot(observeDurability));
      if (mutation(operation) && typeof observeMutation === 'function') {
        await observeMutation(operation, execution);
      }
      executions.push(execution);
    } catch (error) {
      throw bindRunStoreErrorV2(error, authority.authority_id, operation, {
        effect: mutation(operation) ? 'unknown' : 'none',
        retry:
          error?.effect === 'none' ? 'never' : mutation(operation) ? 'reconcile-first' : 'never',
      });
    }
  }
  return {
    executions,
    trace: {
      schema: 'ccm/run-store-oracle-trace/v2',
      authority_id: authority.authority_id,
      consumer_invocations: consumerInvocations,
      capability_invocations: capabilityInvocations,
      operation_digests: operations.map(operationDigestV2),
    },
  };
}
