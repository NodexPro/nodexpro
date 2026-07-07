/**
 * P11.2 — Platform event schema version contract helpers.
 */
import { badRequest } from './errors.js';
import { getPlatformEventCatalogEntry, isKnownPlatformEventType, } from './platform-event-catalog.js';
export function getPlatformEventSchemaVersion(eventType) {
    const entry = getPlatformEventCatalogEntry(eventType);
    if (!entry) {
        throw badRequest(`Unknown platform event_type: ${eventType}`, 'platform_event_unknown');
    }
    return entry.schema_version;
}
export function isSupportedPlatformEventVersion(eventType, schemaVersion) {
    if (!isKnownPlatformEventType(eventType))
        return false;
    if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
        return false;
    }
    const entry = getPlatformEventCatalogEntry(eventType);
    return entry?.schema_version === schemaVersion;
}
export function assertSupportedPlatformEventVersion(eventType, schemaVersion) {
    const entry = getPlatformEventCatalogEntry(eventType);
    if (!entry) {
        throw badRequest(`Unknown platform event_type: ${eventType}`, 'platform_event_unknown');
    }
    if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
        throw badRequest('schema_version must be an integer >= 1', 'platform_event_schema_version_invalid');
    }
    if (entry.schema_version !== schemaVersion) {
        throw badRequest(`Unsupported schema_version ${schemaVersion} for ${eventType}; supported: ${entry.schema_version}`, 'platform_event_schema_version_unsupported');
    }
}
/**
 * Intake guard: catalog-known platform events must declare a supported schema_version.
 * Unknown event types are not validated here (preserves pending_mapping intake path).
 */
export function assertCatalogPlatformEventVersionIfKnown(eventType, schemaVersion) {
    if (!isKnownPlatformEventType(eventType))
        return;
    assertSupportedPlatformEventVersion(eventType, schemaVersion);
}
