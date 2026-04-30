const DEBT_PROVIDER_CODE = 'debt';
export const dashboardDebtProvider = {
    code: DEBT_PROVIDER_CODE,
    required: false,
    supports: () => true,
    async getOverviewPart(_ctx) {
        return {
            summary: {
                debtors_status: 'coming_soon',
                debtors_count: null,
                debtors_amount: null,
            },
        };
    },
    getUnavailablePart(_ctx) {
        return {
            summary: {
                debtors_status: 'unavailable',
                debtors_count: null,
                debtors_amount: null,
            },
        };
    },
};
