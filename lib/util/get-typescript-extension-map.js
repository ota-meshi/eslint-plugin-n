"use strict"

const { getTSConfig, getTSConfigForContext } = require("./get-tsconfig")

const DEFAULT_MAPPING = normalise([
    ["", ".js"],
    [".ts", ".js"],
    [".cts", ".cjs"],
    [".mts", ".mjs"],
    [".tsx", ".js"],
])

const PRESERVE_MAPPING = normalise([
    ["", ".js"],
    [".ts", ".js"],
    [".cts", ".cjs"],
    [".mts", ".mjs"],
    [".tsx", ".jsx"],
])

const tsConfigMapping = {
    react: DEFAULT_MAPPING, // Emit .js files with JSX changed to the equivalent React.createElement calls
    "react-jsx": DEFAULT_MAPPING, // Emit .js files with the JSX changed to _jsx calls
    "react-jsxdev": DEFAULT_MAPPING, // Emit .js files with the JSX changed to _jsx calls
    "react-native": DEFAULT_MAPPING, // Emit .js files with the JSX unchanged
    preserve: PRESERVE_MAPPING, // Emit .jsx files with the JSX unchanged
}

/**
 * @typedef {[string, string][] | keyof typeof tsConfigMapping} TypescriptExtensionMap
 */

/**
 * @typedef ExtensionMap
 * @property {Record<string, string>} forward Convert from typescript to javascript
 * @property {Record<string, string[]>} backward Convert from javascript to typescript
 */

/**
 * @param {[string, string][]} typescriptExtensionMap A forward extension mapping
 * @returns {ExtensionMap}
 */
function normalise(typescriptExtensionMap) {
    /** @type {Record<string, string>} */
    const forward = {}

    /** @type {Record<string, string[]>} */
    const backward = {}

    for (const [typescript, javascript] of typescriptExtensionMap) {
        forward[typescript] = javascript
        if (!typescript) {
            continue
        }
        backward[javascript] ??= []
        backward[javascript].push(typescript)
    }

    return { forward, backward }
}

/**
 * Attempts to get the ExtensionMap from the resolved tsconfig.
 *
 * @param {import("get-tsconfig").TsConfigJsonResolved} [tsconfig] - The resolved tsconfig
 * @returns {ExtensionMap | null} The `typescriptExtensionMap` value, or `null`.
 */
function getMappingFromTSConfig(tsconfig) {
    const jsx = tsconfig?.compilerOptions?.jsx

    if (jsx != null && {}.hasOwnProperty.call(tsConfigMapping, jsx)) {
        return tsConfigMapping[jsx]
    }

    return null
}

/**
 * @typedef Options
 * @property {TypescriptExtensionMap} typescriptExtensionMap
 * @property {string | null} tsconfigPath
 */

/**
 * Gets `typescriptExtensionMap` property from a given option object.
 *
 * @param {Options} [option] - An option object to get.
 * @returns {ExtensionMap | null} The `typescriptExtensionMap` value, or `null`.
 */
function get(option) {
    if (
        typeof option?.typescriptExtensionMap === "string" &&
        {}.hasOwnProperty.call(tsConfigMapping, option?.typescriptExtensionMap)
    ) {
        return tsConfigMapping[option.typescriptExtensionMap]
    }

    if (Array.isArray(option?.typescriptExtensionMap)) {
        return normalise(option.typescriptExtensionMap)
    }

    if (option?.tsconfigPath) {
        return getMappingFromTSConfig(getTSConfig(option?.tsconfigPath))
    }

    return null
}

/**
 * Attempts to get the ExtensionMap from the tsconfig of a given file.
 *
 * @param {import('eslint').Rule.RuleContext} context - The current file context
 * @returns {ExtensionMap | null} The `typescriptExtensionMap` value, or `null`.
 */
function getFromTSConfigFromFile(context) {
    return getMappingFromTSConfig(getTSConfigForContext(context)?.config)
}

/**
 * Gets "typescriptExtensionMap" setting.
 *
 * 1. This checks `options.typescriptExtensionMap`, if its an array then it gets returned.
 * 2. This checks `options.typescriptExtensionMap`, if its a string, convert to the correct mapping.
 * 3. This checks `settings.n.typescriptExtensionMap`, if its an array then it gets returned.
 * 4. This checks `settings.node.typescriptExtensionMap`, if its an array then it gets returned.
 * 5. This checks `settings.n.typescriptExtensionMap`, if its a string, convert to the correct mapping.
 * 6. This checks `settings.node.typescriptExtensionMap`, if its a string, convert to the correct mapping.
 * 7. This checks for a `tsconfig.json` `config.compilerOptions.jsx` property, if its a string, convert to the correct mapping.
 * 8. This returns `PRESERVE_MAPPING`.
 *
 * @param {import('eslint').Rule.RuleContext} context - The rule context.
 * @returns {ExtensionMap} A list of extensions.
 */
module.exports = function getTypescriptExtensionMap(context) {
    return (
        get(/** @type {Options} */ (context.options?.[0])) ||
        get(
            /** @type {Options} */ (
                context.settings?.n ?? context.settings?.node
            )
        ) ||
        getFromTSConfigFromFile(context) ||
        PRESERVE_MAPPING
    )
}

module.exports.schema = {
    oneOf: [
        {
            type: "array",
            items: {
                type: "array",
                prefixItems: [
                    { type: "string", pattern: "^(?:|\\.\\w+)$" },
                    { type: "string", pattern: "^\\.\\w+$" },
                ],
                additionalItems: false,
            },
            uniqueItems: true,
        },
        {
            type: "string",
            enum: Object.keys(tsConfigMapping),
        },
    ],
}
