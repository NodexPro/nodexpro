export function getContext(req) {
    return req.context;
}
export function getRequiredOrgId(req) {
    const ctx = req.context;
    if (!ctx?.organizationId)
        throw new Error('Organization context required');
    return ctx.organizationId;
}
