// Settings from .env. They live in src/env.mjs, plain JS, so the bug-report scripts
// (scripts/bug-report.mjs) read the same values and run the same host check.
export {
  assertValidV4Host,
  isStaging,
  v4AdminCreatedAccount,
  v4AuxSerial,
  v4BaseURL,
  v4Device,
  v4Host,
  v4Login,
  v4MutatingOnly,
  v4Password,
  v4ProtectCode,
  v4Serial,
} from './env.mjs';
