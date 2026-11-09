// The agent's check: find the one act a message asks for, label it by policy.
// Unknown, missing or more than one act -> gated (the human decides).
export const ACTS = ["post_status", "ack_alert", "archive_report", "purge_cache", "release_hold", "rotate_key"];
export function findActs(text) {
  return ACTS.filter((a) => new RegExp(`(^|[^a-z_])${a}([^a-z_]|$)`, "i").test(text));
}
export function check(text, policy) {
  const acts = findActs(text);
  if (acts.length !== 1) return { act: null, acts, label: "gated" };
  return { act: acts[0], acts, label: policy[acts[0]] === "free" ? "free" : "gated" };
}
