"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
const zod_1 = require("zod");
/**
 * Validate request body against a Zod schema.
 * Returns 400 with detailed errors if validation fails.
 * Includes the request correlation ID in the error response for log tracing.
 */
function validate(schema) {
    return (req, res, next) => {
        try {
            req.body = schema.parse(req.body);
            next();
        }
        catch (err) {
            if (err instanceof zod_1.ZodError) {
                const requestId = req.requestId;
                const details = err.errors.map((e) => ({
                    field: e.path.join('.'),
                    message: e.message,
                }));
                res.status(400).json({
                    error: details[0]?.message || 'Validation failed',
                    details,
                    requestId,
                });
                return;
            }
            next(err);
        }
    };
}
