"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.timingSafeEqual = timingSafeEqual;
const crypto_1 = __importDefault(require("crypto"));
function timingSafeEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    return crypto_1.default.timingSafeEqual(bufA, bufB);
}
//# sourceMappingURL=timingSafeCompare.js.map