/**
 * @author Raphael Pigulla
 * See LICENSE file in root directory for full license.
 */
"use strict"

// This list is generated using:
//     `require("module").builtinModules`
//
// This was last updated using Node v13.8.0.
const BUILTIN_MODULES = [
    "_http_agent",
    "_http_client",
    "_http_common",
    "_http_incoming",
    "_http_outgoing",
    "_http_server",
    "_stream_duplex",
    "_stream_passthrough",
    "_stream_readable",
    "_stream_transform",
    "_stream_wrap",
    "_stream_writable",
    "_tls_common",
    "_tls_wrap",
    "assert",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "dns",
    "domain",
    "events",
    "fs",
    "http",
    "http2",
    "https",
    "inspector",
    "module",
    "net",
    "os",
    "path",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "repl",
    "stream",
    "string_decoder",
    "sys",
    "timers",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "v8",
    "vm",
    "worker_threads",
    "zlib",
]

/**
 * @typedef {[
 *   (
 *     | boolean
 *     | {
 *       grouping?: boolean;
 *       allowCall?: boolean;
 *     }
 *   )?
 * ]} RuleOptions
 */
/** @type {import('./rule-module').RuleModule<{RuleOptions: RuleOptions}>} */
module.exports = {
    meta: {
        type: "suggestion",
        docs: {
            description:
                "disallow `require` calls to be mixed with regular variable declarations",
            recommended: false,
            url: "https://github.com/eslint-community/eslint-plugin-n/blob/HEAD/docs/rules/no-mixed-requires.md",
        },
        fixable: null,
        schema: [
            {
                oneOf: [
                    {
                        type: "boolean",
                    },
                    {
                        type: "object",
                        properties: {
                            grouping: {
                                type: "boolean",
                            },
                            allowCall: {
                                type: "boolean",
                            },
                        },
                        additionalProperties: false,
                    },
                ],
            },
        ],
        messages: {
            noMixRequire: "Do not mix 'require' and other declarations.",
            noMixCoreModuleFileComputed:
                "Do not mix core, module, file and computed requires.",
        },
    },

    create(context) {
        const options = context.options[0]
        let grouping = false
        let allowCall = false

        if (typeof options === "object") {
            grouping = options.grouping ?? false
            allowCall = options.allowCall ?? false
        } else {
            grouping = Boolean(options)
        }

        const DECL_REQUIRE = "require"
        const DECL_UNINITIALIZED = "uninitialized"
        const DECL_OTHER = "other"

        const REQ_CORE = "core"
        const REQ_FILE = "file"
        const REQ_MODULE = "module"
        const REQ_COMPUTED = "computed"

        /**
         * Determines the type of a declaration statement.
         * @param {import('estree').Node | undefined | null} initExpression The init node of the VariableDeclarator.
         * @returns {string} The type of declaration represented by the expression.
         */
        function getDeclarationType(initExpression) {
            if (!initExpression) {
                // "var x;"
                return DECL_UNINITIALIZED
            }

            if (
                initExpression.type === "CallExpression" &&
                initExpression.callee.type === "Identifier" &&
                initExpression.callee.name === "require"
            ) {
                // "var x = require('util');"
                return DECL_REQUIRE
            }
            if (
                allowCall &&
                initExpression.type === "CallExpression" &&
                initExpression.callee.type === "CallExpression"
            ) {
                // "var x = require('diagnose')('sub-module');"
                return getDeclarationType(initExpression.callee)
            }
            if (initExpression.type === "MemberExpression") {
                // "var x = require('glob').Glob;"
                return getDeclarationType(initExpression.object)
            }

            // "var x = 42;"
            return DECL_OTHER
        }

        /**
         * Determines the type of module that is loaded via require.
         * @param {import('estree').Expression | import('estree').Super} initExpression The init node of the VariableDeclarator.
         * @returns {string} The module type.
         */
        function inferModuleType(initExpression) {
            if (initExpression.type === "MemberExpression") {
                // "var x = require('glob').Glob;"
                return inferModuleType(initExpression.object)
            }

            if (initExpression.type !== "CallExpression") {
                return REQ_MODULE
            }

            if (initExpression.arguments.length === 0) {
                // "var x = require();"
                return REQ_COMPUTED
            }

            const arg = initExpression.arguments[0]

            if (arg?.type !== "Literal" || typeof arg.value !== "string") {
                // "var x = require(42);"
                return REQ_COMPUTED
            }

            if (BUILTIN_MODULES.indexOf(arg.value) !== -1) {
                // "var fs = require('fs');"
                return REQ_CORE
            }
            if (/^\.{0,2}\//u.test(arg.value)) {
                // "var utils = require('./utils');"
                return REQ_FILE
            }

            // "var async = require('async');"
            return REQ_MODULE
        }

        /**
         * Check if the list of variable declarations is mixed, i.e. whether it
         * contains both require and other declarations.
         * @param {import('estree').VariableDeclarator[]} declarations The list of VariableDeclarators.
         * @returns {boolean} True if the declarations are mixed, false if not.
         */
        function isMixed(declarations) {
            /** @type {Record<string, boolean>} */
            const contains = {}

            for (const declaration of declarations) {
                const type = getDeclarationType(declaration.init)

                contains[type] = true
            }

            return Boolean(
                contains[DECL_REQUIRE] &&
                    (contains[DECL_UNINITIALIZED] || contains[DECL_OTHER])
            )
        }

        /**
         * Check if all require declarations in the given list are of the same
         * type.
         * @param {import('estree').VariableDeclarator[]} declarations The list of VariableDeclarators.
         * @returns {boolean} True if the declarations are grouped, false if not.
         */
        function isGrouped(declarations) {
            /** @type {Record<string, boolean>} */
            const found = {}

            for (const declaration of declarations) {
                if (
                    declaration.init != null &&
                    getDeclarationType(declaration.init) === DECL_REQUIRE
                ) {
                    found[inferModuleType(declaration.init)] = true
                }
            }

            return Object.keys(found).length <= 1
        }

        return {
            VariableDeclaration(node) {
                if (isMixed(node.declarations)) {
                    context.report({
                        node,
                        messageId: "noMixRequire",
                    })
                } else if (grouping && !isGrouped(node.declarations)) {
                    context.report({
                        node,
                        messageId: "noMixCoreModuleFileComputed",
                    })
                }
            },
        }
    },
}
