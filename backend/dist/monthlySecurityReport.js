"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const logger_1 = __importDefault(require("./logger"));
async function generateMonthlySecurityReport() {
    logger_1.default.info('Monthly security report generation triggered');
    // TODO: implement monthly security report logic
}
module.exports = { generateMonthlySecurityReport };
//# sourceMappingURL=monthlySecurityReport.js.map