/**
 * @author Toru Nagashima
 * See LICENSE file in root directory for full license.
 */
"use strict"

const { READ } = require("@eslint-community/eslint-utils")
const checkForPreferGlobal = require("../../util/check-prefer-global")

const traceMap = {
    globals: {
        URLSearchParams: { [READ]: true },
    },
    modules: {
        url: { URLSearchParams: { [READ]: true } },
        "node:url": { URLSearchParams: { [READ]: true } },
    },
}

/** @type {import('../rule-module').RuleModule} */
module.exports = {
    meta: {
        docs: {
            description:
                'enforce either `URLSearchParams` or `require("url").URLSearchParams`',
            recommended: false,
            url: "https://github.com/eslint-community/eslint-plugin-n/blob/HEAD/docs/rules/prefer-global/url-search-params.md",
        },
        type: "suggestion",
        fixable: null,
        schema: [{ enum: ["always", "never"] }],
        messages: {
            preferGlobal:
                "Unexpected use of 'require(\"url\").URLSearchParams'. Use the global variable 'URLSearchParams' instead.",
            preferModule:
                "Unexpected use of the global variable 'URLSearchParams'. Use 'require(\"url\").URLSearchParams' instead.",
        },
    },

    create(context) {
        return {
            "Program:exit"() {
                checkForPreferGlobal(context, traceMap)
            },
        }
    },
}
