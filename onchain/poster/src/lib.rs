//! Off-chain side of the ECV oracle.
//!
//! `encode` maps the JSON `outputs` object produced by `computeEcv()` in
//! `src/ecv/model.mjs` (served by `/api/ecv`) onto the integer fields of the
//! on-chain `EcvRecord`, and back.

pub mod encode;
