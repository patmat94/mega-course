// job.mjs · this role's rule for one task. The factory copies it from factory/make-a-role/jobs/<role>.mjs; a role with
// no rule there gets this one, which leaves every task to the owner.
//   decide({ task, settings, manual, onFile }) → { amount, account?, why } | { flag: reason }
export default function decide() {
  return { flag: 'this role has no job rule yet (factory/make-a-role/jobs/<role>.mjs); every task is the owner\'s call' };
}
