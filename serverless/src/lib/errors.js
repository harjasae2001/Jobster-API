// ─────────────────────────────────────────────────────────────────────────────
// errors.js — Custom error classes, ported from Express errors/ directory
//
// In Express these threw and the error-handler middleware caught them.
// In Lambda each handler catches them explicitly and calls response.error().
// ─────────────────────────────────────────────────────────────────────────────
const { StatusCodes } = require('http-status-codes');

class CustomAPIError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

class BadRequestError extends CustomAPIError {
  constructor(message) {
    super(message);
    this.statusCode = StatusCodes.BAD_REQUEST; // 400
  }
}

class UnauthenticatedError extends CustomAPIError {
  constructor(message) {
    super(message);
    this.statusCode = StatusCodes.UNAUTHORIZED; // 401
  }
}

class NotFoundError extends CustomAPIError {
  constructor(message) {
    super(message);
    this.statusCode = StatusCodes.NOT_FOUND; // 404
  }
}

class ConflictError extends CustomAPIError {
  constructor(message) {
    super(message);
    this.statusCode = StatusCodes.CONFLICT; // 409 — used for duplicate email (replaces Mongoose unique index error)
  }
}

module.exports = {
  CustomAPIError,
  BadRequestError,
  UnauthenticatedError,
  NotFoundError,
  ConflictError,
};
