/**
 * Stable Client Operations UI translation keys.
 * Display only — stored codes, IDs and user-entered values stay unchanged.
 */

export const CO_UI = {
  yes: 'clientOperations.yes',
  no: 'clientOperations.no',
  all: 'clientOperations.all',
  choose: 'clientOperations.choose',
  edit: 'clientOperations.edit',
  clearFilter: 'clientOperations.clearFilter',
  columns: {
    clientName: 'clientOperations.registry.columns.clientName',
    taxId: 'clientOperations.registry.columns.taxId',
    businessType: 'clientOperations.registry.columns.businessType',
    payroll: 'clientOperations.registry.columns.payroll',
    material: 'clientOperations.registry.columns.material',
    pcn: 'clientOperations.registry.columns.pcn',
    vat: 'clientOperations.registry.columns.vat',
    vatDue: 'clientOperations.registry.columns.vatDue',
    incomeTaxAdvance: 'clientOperations.registry.columns.incomeTaxAdvance',
    nationalInsurance: 'clientOperations.registry.columns.nationalInsurance',
    niDeductions: 'clientOperations.registry.columns.niDeductions',
    incomeTaxDeductions: 'clientOperations.registry.columns.incomeTaxDeductions',
    annualReport: 'clientOperations.registry.columns.annualReport',
    capitalDeclaration: 'clientOperations.registry.columns.capitalDeclaration',
    handler: 'clientOperations.registry.columns.handler',
    notes: 'clientOperations.registry.columns.notes',
  },
  filters: {
    reporting: 'clientOperations.registry.filters.reporting',
    material: 'clientOperations.registry.filters.material',
    payroll: 'clientOperations.registry.filters.payroll',
    reportingType: 'clientOperations.registry.filters.reportingType',
    businessType: 'clientOperations.registry.filters.businessType',
    handler: 'clientOperations.registry.filters.handler',
    reported: 'clientOperations.registry.filters.reported',
    notReported: 'clientOperations.registry.filters.notReported',
    received: 'clientOperations.registry.filters.received',
    notReceived: 'clientOperations.registry.filters.notReceived',
    hasPayroll: 'clientOperations.registry.filters.hasPayroll',
    noPayroll: 'clientOperations.registry.filters.noPayroll',
    unassigned: 'clientOperations.registry.filters.unassigned',
    itaMonthly: 'clientOperations.registry.filters.itaMonthly',
    itaBimonthly: 'clientOperations.registry.filters.itaBimonthly',
    itaExempt: 'clientOperations.registry.filters.itaExempt',
    vatMonthly: 'clientOperations.registry.filters.vatMonthly',
    vatBimonthly: 'clientOperations.registry.filters.vatBimonthly',
    itdMonthly: 'clientOperations.registry.filters.itdMonthly',
    itdBimonthly: 'clientOperations.registry.filters.itdBimonthly',
    itdSemiannual: 'clientOperations.registry.filters.itdSemiannual',
  },
  reporting: {
    kpi: {
      vat: 'clientOperations.registry.reporting.kpi.vat',
      incomeTax: 'clientOperations.registry.reporting.kpi.incomeTax',
      incomeTaxDeductions: 'clientOperations.registry.reporting.kpi.incomeTaxDeductions',
      nationalInsuranceDeductions: 'clientOperations.registry.reporting.kpi.nationalInsuranceDeductions',
      payroll: 'clientOperations.registry.reporting.kpi.payroll',
      nationalInsurance: 'clientOperations.registry.reporting.kpi.nationalInsurance',
      withholding: 'clientOperations.registry.reporting.kpi.withholding',
      annual: 'clientOperations.registry.reporting.kpi.annual',
      capitalDeclaration: 'clientOperations.registry.reporting.kpi.capitalDeclaration',
      paymentsOutstanding: 'clientOperations.registry.reporting.kpi.paymentsOutstanding',
      paymentsOutstandingTooltip: 'clientOperations.registry.reporting.kpi.paymentsOutstandingTooltip',
    },
    remaining: 'clientOperations.registry.reporting.remaining',
    previousIncomplete: 'clientOperations.registry.reporting.previousIncomplete',
    previousIncompleteCount: 'clientOperations.registry.reporting.previousIncompleteCount',
    overduePeriods: 'clientOperations.registry.reporting.overduePeriods',
    sortLabel: 'clientOperations.registry.reporting.sortLabel',
    sortPriority: 'clientOperations.registry.reporting.sortPriority',
    sortClientName: 'clientOperations.registry.reporting.sortClientName',
    markSubmitted: 'clientOperations.registry.reporting.markSubmitted',
    markNotSubmitted: 'clientOperations.registry.reporting.markNotSubmitted',
    submittedCheck: 'clientOperations.registry.reporting.submittedCheck',
    filterAll: 'clientOperations.registry.reporting.filterAll',
    cell: {
      submitted: 'clientOperations.registry.reporting.cell.submitted',
      overdue: 'clientOperations.registry.reporting.cell.overdue',
      urgent: 'clientOperations.registry.reporting.cell.urgent',
      warning: 'clientOperations.registry.reporting.cell.warning',
      open: 'clientOperations.registry.reporting.cell.open',
      notApplicable: 'clientOperations.registry.reporting.cell.notApplicable',
      unknown: 'clientOperations.registry.reporting.cell.unknown',
      informational: 'clientOperations.registry.reporting.cell.informational',
      paymentOutstanding: 'clientOperations.registry.reporting.cell.paymentOutstanding',
      paymentPartial: 'clientOperations.registry.reporting.cell.paymentPartial',
      paymentUnknown: 'clientOperations.registry.reporting.cell.paymentUnknown',
    },
    period: {
      monthly: 'clientOperations.registry.reporting.period.monthly',
      bimonthly: 'clientOperations.registry.reporting.period.bimonthly',
    },
    row: {
      complete: 'clientOperations.registry.reporting.row.complete',
      overdue: 'clientOperations.registry.reporting.row.overdue',
      urgent: 'clientOperations.registry.reporting.row.urgent',
      warning: 'clientOperations.registry.reporting.row.warning',
      paymentOutstanding: 'clientOperations.registry.reporting.row.paymentOutstanding',
      neutral: 'clientOperations.registry.reporting.row.neutral',
      none: 'clientOperations.registry.reporting.row.none',
    },
    payment: {
      question: 'clientOperations.registry.reporting.payment.question',
      paidInFull: 'clientOperations.registry.reporting.payment.paidInFull',
      outstanding: 'clientOperations.registry.reporting.payment.outstanding',
      partiallyPaid: 'clientOperations.registry.reporting.payment.partiallyPaid',
      notRequired: 'clientOperations.registry.reporting.payment.notRequired',
      confirm: 'clientOperations.registry.reporting.payment.confirm',
      cancel: 'clientOperations.registry.reporting.payment.cancel',
      updateTitle: 'clientOperations.registry.reporting.payment.updateTitle',
    },
    filing: {
      title: 'clientOperations.registry.reporting.filing.title',
      client: 'clientOperations.registry.reporting.filing.client',
      period: 'clientOperations.registry.reporting.filing.period',
      frequency: 'clientOperations.registry.reporting.filing.frequency',
      status: 'clientOperations.registry.reporting.filing.status',
      confirmAction: 'clientOperations.registry.reporting.filing.confirmAction',
      report: 'clientOperations.registry.reporting.filing.report',
      reportAndPaid: 'clientOperations.registry.reporting.filing.reportAndPaid',
      paid: 'clientOperations.registry.reporting.filing.paid',
      filedOn: 'clientOperations.registry.reporting.filing.filedOn',
      reference: 'clientOperations.registry.reporting.filing.reference',
      paymentStatus: 'clientOperations.registry.reporting.filing.paymentStatus',
      notRecorded: 'clientOperations.registry.reporting.filing.notRecorded',
      save: 'clientOperations.registry.reporting.filing.save',
      cancel: 'clientOperations.registry.reporting.filing.cancel',
    },
    ni: {
      title: 'clientOperations.registry.reporting.ni.title',
      clientDetails: 'clientOperations.registry.reporting.ni.clientDetails',
      client: 'clientOperations.registry.reporting.ni.client',
      month: 'clientOperations.registry.reporting.ni.month',
      amount: 'clientOperations.registry.reporting.ni.amount',
      handlingTitle: 'clientOperations.registry.reporting.ni.handlingTitle',
      standingActive: 'clientOperations.registry.reporting.ni.standingActive',
      standingInactive: 'clientOperations.registry.reporting.ni.standingInactive',
      clientPays: 'clientOperations.registry.reporting.ni.clientPays',
      manualMonthly: 'clientOperations.registry.reporting.ni.manualMonthly',
      methodUnresolved: 'clientOperations.registry.reporting.ni.methodUnresolved',
      standingOffice: 'clientOperations.registry.reporting.ni.standingOffice',
      resolution: 'clientOperations.registry.reporting.ni.resolution',
      resolutionDone: 'clientOperations.registry.reporting.ni.resolutionDone',
      resolutionOpen: 'clientOperations.registry.reporting.ni.resolutionOpen',
      confirmResolution: 'clientOperations.registry.reporting.ni.confirmResolution',
      monthHandled: 'clientOperations.registry.reporting.ni.monthHandled',
      save: 'clientOperations.registry.reporting.ni.save',
      cancel: 'clientOperations.registry.reporting.ni.cancel',
    },
  },
  businessType: {
    osekPatur: 'clientOperations.businessType.osekPatur',
    osekMurshe: 'clientOperations.businessType.osekMurshe',
    company: 'clientOperations.businessType.company',
    corporation: 'clientOperations.businessType.corporation',
    other: 'clientOperations.businessType.other',
    unset: 'clientOperations.enums.notSet',
  },
  enums: {
    monthly: 'clientOperations.enums.frequency.monthly',
    biMonthly: 'clientOperations.enums.frequency.biMonthly',
    semiAnnual: 'clientOperations.enums.frequency.semiAnnual',
    notRelevant: 'clientOperations.enums.notRelevant',
    notApplicable: 'clientOperations.enums.notApplicable',
    exempt: 'clientOperations.enums.exempt',
    regular: 'clientOperations.enums.vatDue.regular',
    credit: 'clientOperations.enums.payment.credit',
    standingOrder: 'clientOperations.enums.payment.standingOrder',
    voucher: 'clientOperations.enums.payment.voucher',
    other: 'clientOperations.enums.payment.other',
  },
  taxes: {
    title: 'clientOperations.taxes.title',
    vatRegistration: 'clientOperations.taxes.cards.vatRegistration',
    incomeTaxAdvances: 'clientOperations.taxes.cards.incomeTaxAdvances',
    incomeTaxDeductions: 'clientOperations.taxes.cards.incomeTaxDeductions',
    nationalInsurance: 'clientOperations.taxes.cards.nationalInsurance',
    niSelfEmployed: 'clientOperations.taxes.cards.niSelfEmployed',
    vatPayment: 'clientOperations.taxes.cards.vatPayment',
    incomeTaxPayment: 'clientOperations.taxes.cards.incomeTaxPayment',
    notes: 'clientOperations.taxes.cards.notes',
    vat: 'clientOperations.taxes.fields.vat',
    vatFrequency: 'clientOperations.taxes.fields.vatFrequency',
    vatDueDay: 'clientOperations.taxes.fields.vatDueDay',
    advances: 'clientOperations.taxes.fields.advances',
    percent: 'clientOperations.taxes.fields.percent',
    reportingFrequency: 'clientOperations.taxes.fields.reportingFrequency',
    deductionsFile: 'clientOperations.taxes.fields.deductionsFile',
    monthlyAmount: 'clientOperations.taxes.fields.monthlyAmount',
    howPaysVat: 'clientOperations.taxes.fields.howPaysVat',
    howPaysIncomeTax: 'clientOperations.taxes.fields.howPaysIncomeTax',
    paymentDescription: 'clientOperations.taxes.fields.paymentDescription',
    cardholder: 'clientOperations.taxes.payment.cardholder',
    card: 'clientOperations.taxes.payment.card',
    expiry: 'clientOperations.taxes.payment.expiry',
    cardExpired: 'clientOperations.taxes.payment.cardExpired',
    cvvFooter: 'clientOperations.taxes.payment.cvvFooter',
    fields: {
      vat: 'clientOperations.taxes.fields.vat',
      vatFrequency: 'clientOperations.taxes.fields.vatFrequency',
      vatDueDay: 'clientOperations.taxes.fields.vatDueDay',
      advances: 'clientOperations.taxes.fields.advances',
      percent: 'clientOperations.taxes.fields.percent',
      reportingFrequency: 'clientOperations.taxes.fields.reportingFrequency',
      deductionsFile: 'clientOperations.taxes.fields.deductionsFile',
      monthlyAmount: 'clientOperations.taxes.fields.monthlyAmount',
      howPaysVat: 'clientOperations.taxes.fields.howPaysVat',
      howPaysIncomeTax: 'clientOperations.taxes.fields.howPaysIncomeTax',
      paymentDescription: 'clientOperations.taxes.fields.paymentDescription',
    },
    payment: {
      cardholder: 'clientOperations.taxes.payment.cardholder',
      card: 'clientOperations.taxes.payment.card',
      expiry: 'clientOperations.taxes.payment.expiry',
      cardExpired: 'clientOperations.taxes.payment.cardExpired',
      cvvFooter: 'clientOperations.taxes.payment.cvvFooter',
    },
    creditConfigured: 'clientOperations.taxes.creditConfigured',
    copy: 'clientOperations.taxes.copy',
    copyAria: {
      cardholder: 'clientOperations.taxes.copyAria.cardholder',
      taxId: 'clientOperations.taxes.copyAria.taxId',
      deductionsFile: 'clientOperations.taxes.copyAria.deductionsFile',
      card: 'clientOperations.taxes.copyAria.card',
      expiry: 'clientOperations.taxes.copyAria.expiry',
    },
  },
  payroll: {
    title: 'clientOperations.payroll.title',
    always: 'clientOperations.payroll.always',
    usually: 'clientOperations.payroll.usually',
    fixedDelay: 'clientOperations.payroll.fixedDelay',
    low: 'clientOperations.payroll.low',
    medium: 'clientOperations.payroll.medium',
    high: 'clientOperations.payroll.high',
    form126Schedule: 'clientOperations.payroll.form126Schedule',
  },
  businessProfile: {
    section: 'clientOperations.businessProfile.title',
    groups: {
      business_scope: 'clientOperations.businessProfile.groups.businessScope',
      address: 'clientOperations.businessProfile.groups.address',
      general_info: 'clientOperations.businessProfile.groups.general',
    },
  },
  quickProfile: {
    fixedExpenses: 'clientOperations.quickProfile.fixedExpenses',
    vehicle: 'clientOperations.quickProfile.vehicle',
    vehicleN: 'clientOperations.accounting.vehicleN',
    vehicles: 'clientOperations.accounting.blocks.vehicles',
  },
  toolbar: {
    undo: 'clientOperations.undo',
    redo: 'clientOperations.redo',
    search: 'clientOperations.search',
    filter: 'clientOperations.filter',
    sortAsc: 'clientOperations.sortAsc',
    sortDesc: 'clientOperations.sortDesc',
    alignRight: 'clientOperations.alignRight',
    alignCenter: 'clientOperations.alignCenter',
    alignLeft: 'clientOperations.alignLeft',
    wrapText: 'clientOperations.wrapText',
    bold: 'clientOperations.bold',
    italic: 'clientOperations.italic',
    underline: 'clientOperations.underline',
    textColor: 'clientOperations.textColor',
    fillColor: 'clientOperations.fillColor',
    numberFormat: 'clientOperations.numberFormat',
    borders: 'clientOperations.borders',
    freezeColumns: 'clientOperations.freezeColumns',
    toggleColumns: 'clientOperations.showHideColumns',
    fullscreen: 'clientOperations.fullscreen',
    addColumn: 'clientOperations.addColumn',
    filterUnavailable: 'clientOperations.toolbar.filterUnavailable',
    addColumnUnavailable: 'clientOperations.toolbar.addColumnUnavailable',
  },
  documents: {
    tabTitle: 'clientOperations.documents.tabTitle',
    addFolder: 'clientOperations.documents.addFolder',
    addDocument: 'clientOperations.documents.addDocument',
    emptyFolders: 'clientOperations.documents.emptyFolders',
    emptyDocuments: 'clientOperations.documents.emptyDocuments',
    folders: {
      opening_dossier: 'clientOperations.documents.folders.openingDossier',
      withholdings: 'clientOperations.documents.folders.withholdings',
      id_and_license: 'clientOperations.documents.folders.idAndLicense',
      business_certificate: 'clientOperations.documents.folders.businessCertificate',
      letters: 'clientOperations.documents.folders.letters',
      forms: 'clientOperations.documents.folders.forms',
      assessments: 'clientOperations.documents.folders.assessments',
      payroll: 'clientOperations.documents.folders.payroll',
      case_closure: 'clientOperations.documents.folders.caseClosure',
    },
  },
  workspace: {
    office: 'clientOperations.workspaceOffice',
    officeShort: 'clientOperations.workspaceOfficeShort',
    myClients: 'clientOperations.workspaceMyClients',
  },
  statusPaint: {
    ready: 'clientOperations.statusPaintModes.ready',
    sent_for_approval: 'clientOperations.statusPaintModes.sentForApproval',
    completed: 'clientOperations.statusPaintModes.completed',
    clear: 'clientOperations.statusPaintModes.clear',
  },
  history: {
    title: 'clientOperations.history.title',
    emptyRange: 'clientOperations.history.emptyRange',
    retentionNotice: 'clientOperations.history.retentionNotice',
    archivalTodo: 'clientOperations.history.archivalTodo',
    sections: {
      client_profile: 'clientOperations.history.sections.clientProfile',
      taxes: 'clientOperations.history.sections.taxes',
      accounting: 'clientOperations.history.sections.accounting',
      fees: 'clientOperations.history.sections.fees',
      payroll: 'clientOperations.history.sections.payroll',
      annual: 'clientOperations.history.sections.annual',
      documents: 'clientOperations.history.sections.documents',
      history_system: 'clientOperations.history.sections.system',
    },
    summaries: {
      secureCardAccess: 'clientOperations.history.summaries.secureCardAccess',
      paymentReveal: 'clientOperations.history.summaries.paymentReveal',
      paymentRevealNamed: 'clientOperations.history.summaries.paymentRevealNamed',
      taxesUpdated: 'clientOperations.history.summaries.taxesUpdated',
      taxesUpdatedNamed: 'clientOperations.history.summaries.taxesUpdatedNamed',
      accountingUpdated: 'clientOperations.history.summaries.accountingUpdated',
      payrollUpdated: 'clientOperations.history.summaries.payrollUpdated',
      payrollUpdatedFields: 'clientOperations.history.summaries.payrollUpdatedFields',
      annualCmd: 'clientOperations.history.summaries.annualCmd',
      documentsCmd: 'clientOperations.history.summaries.documentsCmd',
      documentsUpdated: 'clientOperations.history.summaries.documentsUpdated',
      annualFileUploaded: 'clientOperations.history.summaries.annualFileUploaded',
      annualFileUploadedNamed: 'clientOperations.history.summaries.annualFileUploadedNamed',
      fileUploadedBeforeLink: 'clientOperations.history.summaries.fileUploadedBeforeLink',
      fileUploadedBeforeLinkNamed: 'clientOperations.history.summaries.fileUploadedBeforeLinkNamed',
      fileAttached: 'clientOperations.history.summaries.fileAttached',
      annualFileOpened: 'clientOperations.history.summaries.annualFileOpened',
      documentFileOpened: 'clientOperations.history.summaries.documentFileOpened',
      fileOpened: 'clientOperations.history.summaries.fileOpened',
      obligationClick: 'clientOperations.history.summaries.obligationClick',
      tasksClick: 'clientOperations.history.summaries.tasksClick',
      nightRun: 'clientOperations.history.summaries.nightRun',
      nightRunClients: 'clientOperations.history.summaries.nightRunClients',
      event: 'clientOperations.history.summaries.event',
      clientProfileUpdated: 'clientOperations.history.summaries.clientProfileUpdated',
      clientProfileUpdatedFields: 'clientOperations.history.summaries.clientProfileUpdatedFields',
      feeAgreementUpdated: 'clientOperations.history.summaries.feeAgreementUpdated',
      feeServiceLineAdded: 'clientOperations.history.summaries.feeServiceLineAdded',
      feeServiceLineUpdated: 'clientOperations.history.summaries.feeServiceLineUpdated',
      feeServiceLineRemoved: 'clientOperations.history.summaries.feeServiceLineRemoved',
      feeCustomLineAdded: 'clientOperations.history.summaries.feeCustomLineAdded',
      feeCustomLineUpdated: 'clientOperations.history.summaries.feeCustomLineUpdated',
      feeCustomLineRemoved: 'clientOperations.history.summaries.feeCustomLineRemoved',
      feeAction: 'clientOperations.history.summaries.feeAction',
      documentsInitialized: 'clientOperations.history.summaries.documentsInitialized',
      documentsFolderCreated: 'clientOperations.history.summaries.documentsFolderCreated',
      documentsFolderRenamed: 'clientOperations.history.summaries.documentsFolderRenamed',
      documentsFolderArchived: 'clientOperations.history.summaries.documentsFolderArchived',
      documentsUploaded: 'clientOperations.history.summaries.documentsUploaded',
      documentsDeleted: 'clientOperations.history.summaries.documentsDeleted',
    },
    subjects: {
      payrollPeriod: 'clientOperations.history.subjects.payrollPeriod',
      niDeductions: 'clientOperations.history.subjects.niDeductions',
      niSelfEmployed: 'clientOperations.history.subjects.niSelfEmployed',
      vat: 'clientOperations.history.subjects.vat',
      incomeTaxAdvances: 'clientOperations.history.subjects.incomeTaxAdvances',
      payroll: 'clientOperations.history.subjects.payroll',
      obligations: 'clientOperations.history.subjects.obligations',
    },
    results: {
      actionCompleted: 'clientOperations.history.results.actionCompleted',
      taskClosed: 'clientOperations.history.results.taskClosed',
      taskSnoozed: 'clientOperations.history.results.taskSnoozed',
      taskReopened: 'clientOperations.history.results.taskReopened',
    },
    buttons: {
      resolveTask: 'clientOperations.history.buttons.resolveTask',
      snoozeTask: 'clientOperations.history.buttons.snoozeTask',
      reopenTask: 'clientOperations.history.buttons.reopenTask',
    },
  },
  notes: {
    conflictTitle: 'clientOperations.notes.conflictTitle',
    conflictMessage: 'clientOperations.notes.conflictMessage',
    createAnyway: 'clientOperations.notes.createAnyway',
    changeTime: 'clientOperations.notes.changeTime',
    call: 'clientOperations.notes.call',
    reminder: 'clientOperations.notes.reminder',
    greeting: 'clientOperations.notes.greeting',
  },
  obligations: {
    title: 'clientOperations.obligations.title',
    table: 'clientOperations.obligations.table',
    noneOpen: 'clientOperations.obligations.noneOpen',
    noAnnual: 'clientOperations.obligations.noAnnual',
    noPeriods: 'clientOperations.obligations.noPeriods',
    periodSummary: 'clientOperations.obligations.periodSummary',
    annualReport: 'clientOperations.obligations.annualReport',
    overdue: 'clientOperations.obligations.overdue',
    soon: 'clientOperations.obligations.soon',
    today: 'clientOperations.obligations.today',
    notRequired: 'clientOperations.obligations.notRequired',
    updateAmount: 'clientOperations.obligations.updateAmount',
    monthlyAmount: 'clientOperations.obligations.monthlyAmount',
    dontShowThisMonth: 'clientOperations.obligations.dontShowThisMonth',
    standingOrder: 'clientOperations.obligations.standingOrder',
    sendDataRequest: 'clientOperations.obligations.sendDataRequest',
    payrollPeriod: 'clientOperations.obligations.payrollPeriod',
    vatPeriod: 'clientOperations.obligations.vatPeriod',
    period: 'clientOperations.obligations.period',
    notRelevant: 'clientOperations.obligations.notRelevant',
    blocked: 'clientOperations.obligations.blocked',
    paid: 'clientOperations.obligations.paid',
    reported: 'clientOperations.obligations.reported',
    notStarted: 'clientOperations.obligations.notStarted',
    ok: 'clientOperations.obligations.ok',
    materialReceived: 'clientOperations.obligations.materialReceived',
    missingData: 'clientOperations.obligations.missingData',
    noPayrollThisMonth: 'clientOperations.obligations.noPayrollThisMonth',
    inProgress: 'clientOperations.obligations.inProgress',
    readyToPay: 'clientOperations.obligations.readyToPay',
    unpaid: 'clientOperations.obligations.unpaid',
    urgentToday: 'clientOperations.obligations.urgentToday',
    handleSoon: 'clientOperations.obligations.handleSoon',
    noEmployees: 'clientOperations.obligations.noEmployees',
    markReported: 'clientOperations.obligations.markReported',
    requestDocuments: 'clientOperations.obligations.requestDocuments',
    waitingForMaterial: 'clientOperations.obligations.waitingForMaterial',
    waitingForSalaryData: 'clientOperations.obligations.waitingForSalaryData',
    waitingForIncomeData: 'clientOperations.obligations.waitingForIncomeData',
    waitingClientResponse: 'clientOperations.obligations.waitingClientResponse',
    readyToReport: 'clientOperations.obligations.readyToReport',
    readyToProcess: 'clientOperations.obligations.readyToProcess',
    pendingPayment: 'clientOperations.obligations.pendingPayment',
    notReported: 'clientOperations.obligations.notReported',
    reportedLate: 'clientOperations.obligations.reportedLate',
    reportedAndPaid: 'clientOperations.obligations.reportedAndPaid',
    paidOnTime: 'clientOperations.obligations.paidOnTime',
    paidLate: 'clientOperations.obligations.paidLate',
    paidAndReportedOnTime: 'clientOperations.obligations.paidAndReportedOnTime',
    waiting: 'clientOperations.obligations.waiting',
    waitingForPayroll: 'clientOperations.obligations.waitingForPayroll',
    missingReportingFrequency: 'clientOperations.obligations.missingReportingFrequency',
    amountNotSet: 'clientOperations.obligations.amountNotSet',
    advances: 'clientOperations.obligations.advances',
    stillUnpaid: 'clientOperations.obligations.stillUnpaid',
    markNotRelevantAction: 'clientOperations.obligations.markNotRelevantAction',
    requestDocumentsFromClient: 'clientOperations.obligations.requestDocumentsFromClient',
    markMaterialReceived: 'clientOperations.obligations.markMaterialReceived',
    requestSalaryData: 'clientOperations.obligations.requestSalaryData',
    markSalaryReceived: 'clientOperations.obligations.markSalaryReceived',
    requestIncome: 'clientOperations.obligations.requestIncome',
    markIncomeReceived: 'clientOperations.obligations.markIncomeReceived',
    markSubmitted: 'clientOperations.obligations.markSubmitted',
    markSubmittedAndPaid: 'clientOperations.obligations.markSubmittedAndPaid',
    markNotReported: 'clientOperations.obligations.markNotReported',
    openModule: 'clientOperations.obligations.openModule',
    performAction: 'clientOperations.obligations.performAction',
    requestData: 'clientOperations.obligations.requestData',
    markReceived: 'clientOperations.obligations.markReceived',
    update: 'clientOperations.obligations.update',
    openTaxes: 'clientOperations.obligations.openTaxes',
    openVat: 'clientOperations.obligations.openVat',
    showTasks: 'clientOperations.obligations.showTasks',
    salaryDataReceived: 'clientOperations.obligations.salaryDataReceived',
    salariesSentToEmployer: 'clientOperations.obligations.salariesSentToEmployer',
    niDeductionsPaid: 'clientOperations.obligations.niDeductionsPaid',
    payrollInProgress: 'clientOperations.obligations.payrollInProgress',
    openDocuments: 'clientOperations.obligations.openDocuments',
    openPayroll: 'clientOperations.obligations.openPayroll',
    openRelatedModule: 'clientOperations.obligations.openRelatedModule',
    updatePayroll: 'clientOperations.obligations.updatePayroll',
    niPaymentTitle: 'clientOperations.obligations.niPaymentTitle',
    niDeductionsReminder: 'clientOperations.obligations.niDeductionsReminder',
    updateNiDeductions: 'clientOperations.obligations.updateNiDeductions',
    niDeductionsDueBy15: 'clientOperations.obligations.niDeductionsDueBy15',
    niDeductionsFollowSteps: 'clientOperations.obligations.niDeductionsFollowSteps',
    itdBlockedUntilPayroll: 'clientOperations.obligations.itdBlockedUntilPayroll',
    itdNotRequiredThisMonth: 'clientOperations.obligations.itdNotRequiredThisMonth',
    itdReportingPeriod: 'clientOperations.obligations.itdReportingPeriod',
    niSelfEmployedPeriod: 'clientOperations.obligations.niSelfEmployedPeriod',
    currentPayrollPeriod: 'clientOperations.obligations.currentPayrollPeriod',
    niDeductionsForPeriod: 'clientOperations.obligations.niDeductionsForPeriod',
    save: 'clientOperations.save',
    close: 'clientOperations.close',
    form102Reported: 'clientOperations.payroll.form102Reported',
    form100Reported: 'clientOperations.payroll.form100Reported',
    incomeTaxDeductionsTitle: 'clientOperations.taxes.cards.incomeTaxDeductions',
    niSelfEmployed: 'clientOperations.taxes.cards.niSelfEmployed',
    columns: {
      payroll: 'clientOperations.obligations.columns.payroll',
      materialBrought: 'clientOperations.obligations.columns.materialBrought',
      vat: 'clientOperations.obligations.columns.vat',
      vatDue: 'clientOperations.obligations.columns.vatDue',
      incomeTaxAdvances: 'clientOperations.obligations.columns.incomeTaxAdvances',
      nationalInsurance: 'clientOperations.obligations.columns.nationalInsurance',
      niDeductions: 'clientOperations.obligations.columns.niDeductions',
      incomeTaxDeductions: 'clientOperations.obligations.columns.incomeTaxDeductions',
      priority: 'clientOperations.obligations.columns.priority',
    },
  },
} as const;

export const FEE_SERVICE_LABEL_KEY: Record<string, string> = {
  accounting_single_sided: 'clientOperations.fees.services.accountingSingleSided',
  accounting_double_sided: 'clientOperations.fees.services.accountingDoubleSided',
  bank_reconciliations: 'clientOperations.fees.services.bankReconciliations',
  credit_card_reconciliations: 'clientOperations.fees.services.creditCardReconciliations',
  customer_reconciliations: 'clientOperations.fees.services.customerReconciliations',
  supplier_reconciliations: 'clientOperations.fees.services.supplierReconciliations',
  periodic_reports: 'clientOperations.fees.services.periodicReports',
  vat_reporting: 'clientOperations.fees.services.vatReporting',
  income_tax_advances_reporting: 'clientOperations.fees.services.incomeTaxAdvancesReporting',
  withholding_reporting: 'clientOperations.fees.services.withholdingReporting',
  national_insurance_reporting: 'clientOperations.fees.services.nationalInsuranceReporting',
  annual_report: 'clientOperations.fees.services.annualReport',
  capital_declaration: 'clientOperations.fees.services.capitalDeclaration',
  authority_letters: 'clientOperations.fees.services.authorityLetters',
  payslip_preparation: 'clientOperations.fees.services.payslipPreparation',
  payroll_reporting: 'clientOperations.fees.services.payrollReporting',
  business_closure: 'clientOperations.fees.services.businessClosure',
  pension_funds: 'clientOperations.fees.services.pensionFunds',
  file_open: 'clientOperations.fees.services.fileOpen',
  file_close: 'clientOperations.fees.services.fileClose',
  tax_refund: 'clientOperations.fees.services.taxRefund',
  special_one_time: 'clientOperations.fees.services.specialOneTime',
  meeting_consult: 'clientOperations.fees.services.meetingConsult',
  osek_patur_declaration: 'clientOperations.fees.services.osekPaturDeclaration',
  advance_cancellation: 'clientOperations.fees.services.advanceCancellation',
  salary_by_payslips: 'clientOperations.fees.services.salaryByPayslips',
  salary_monthly_fixed: 'clientOperations.fees.services.salaryMonthlyFixed',
  authority_debts: 'clientOperations.fees.services.authorityDebts',
  forms_fill: 'clientOperations.fees.services.formsFill',
  tax_consult_calc: 'clientOperations.fees.services.taxConsultCalc',
  misc_reports: 'clientOperations.fees.services.miscReports',
  business_planning: 'clientOperations.fees.services.businessPlanning',
};

export const PAYROLL_SECTION_TITLE_KEY: Record<string, string> = {
  status: 'clientOperations.payroll.payrollStatus',
  employer_details: 'clientOperations.payroll.employerDetails',
  deductions: 'clientOperations.payroll.deductions',
  bank: 'clientOperations.payroll.bankDetails',
  reporting: 'clientOperations.payroll.reporting',
  process: 'clientOperations.payroll.process',
  complexity: 'clientOperations.payroll.complexity',
  employees: 'clientOperations.payroll.employees',
};

export const PAYROLL_LINE_LABEL_KEY: Record<string, string> = {
  has_employees: 'clientOperations.payroll.hasEmployees',
  company_name: 'clientOperations.payroll.companyName',
  founded_year: 'clientOperations.payroll.foundedYear',
  city: 'clientOperations.payroll.city',
  street: 'clientOperations.payroll.street',
  postal_code: 'clientOperations.payroll.postalCode',
  phone: 'clientOperations.payroll.phone',
  email: 'clientOperations.payroll.email',
  income_tax_deductions: 'clientOperations.payroll.incomeTaxDeductions',
  ni_deductions: 'clientOperations.payroll.niDeductions',
  employer_id_bl: 'clientOperations.payroll.employerIdBl',
  bank_number: 'clientOperations.payroll.bankNumber',
  bank_branch: 'clientOperations.payroll.bankBranch',
  bank_account: 'clientOperations.payroll.bankAccount',
  reporting_income_tax: 'clientOperations.payroll.incomeTaxReporting',
  form_102: 'clientOperations.payroll.form102Reported',
  form_100: 'clientOperations.payroll.form100Reported',
  form_126: 'clientOperations.payroll.form126',
  domain: 'clientOperations.payroll.domain',
  payroll_software: 'clientOperations.payroll.softwareQuestion',
  data_delivery: 'clientOperations.payroll.dataDelivery',
  data_sender: 'clientOperations.payroll.dataSender',
  data_received_day: 'clientOperations.payroll.dataReceivedDay',
  salary_payment_day: 'clientOperations.payroll.salaryPaymentDay',
  data_on_time: 'clientOperations.payroll.dataOnTime',
  contact_name: 'clientOperations.payroll.contactName',
  contact_phone: 'clientOperations.payroll.contactPhone',
  contact_email: 'clientOperations.payroll.contactEmail',
  complexity_level: 'clientOperations.payroll.complexityLevel',
  requires_fixes: 'clientOperations.payroll.requiresFixes',
  special_arrangements: 'clientOperations.payroll.specialArrangements',
  notes: 'clientOperations.payroll.notes',
  employees_count: 'clientOperations.payroll.employeeCount',
  employees_chart: 'clientOperations.payroll.employeeChangeChart',
};

/** Edit-field key → payroll line_key (PAYROLL_LINE_LABEL_KEY). */
export const PAYROLL_FIELD_LINE_KEY: Record<string, string> = {
  has_employees: 'has_employees',
  employer_company_name_override: 'company_name',
  employer_company_founded_year_override: 'founded_year',
  employer_city_override: 'city',
  employer_street_override: 'street',
  employer_postal_code_override: 'postal_code',
  employer_phone_override: 'phone',
  employer_email_override: 'email',
  employer_id_bl: 'employer_id_bl',
  bank_number: 'bank_number',
  bank_branch: 'bank_branch',
  bank_account: 'bank_account',
  reporting_income_tax_frequency: 'reporting_income_tax',
  form_102_reported: 'form_102',
  form_100_reported: 'form_100',
  process_payroll_software: 'payroll_software',
  process_data_delivery_method: 'data_delivery',
  process_data_sender: 'data_sender',
  process_data_received_day: 'data_received_day',
  process_salary_payment_day: 'salary_payment_day',
  process_data_received_timeliness: 'data_on_time',
  process_payroll_contact_name: 'contact_name',
  process_payroll_contact_phone: 'contact_phone',
  process_payroll_contact_email: 'contact_email',
  complexity_level: 'complexity_level',
  complexity_requires_fixes: 'requires_fixes',
  complexity_special_arrangements: 'special_arrangements',
  complexity_notes: 'notes',
  employees_count: 'employees_count',
  employees_trend: 'employees_chart',
};

export function payrollOptionLabelKey(value: string | null | undefined): string | undefined {
  switch (String(value ?? '')) {
    case 'yes':
      return CO_UI.yes;
    case 'no':
      return CO_UI.no;
    case 'monthly':
      return CO_UI.enums.monthly;
    case 'bi_monthly':
      return CO_UI.enums.biMonthly;
    case 'semi_annual':
      return CO_UI.enums.semiAnnual;
    case 'always':
      return CO_UI.payroll.always;
    case 'usually':
      return CO_UI.payroll.usually;
    case 'fixed_delay':
      return CO_UI.payroll.fixedDelay;
    case 'low':
      return CO_UI.payroll.low;
    case 'medium':
      return CO_UI.payroll.medium;
    case 'high':
      return CO_UI.payroll.high;
    default:
      return undefined;
  }
}

export function payrollLineLabelKey(lineKey: string): string | undefined {
  return PAYROLL_LINE_LABEL_KEY[lineKey];
}

export function payrollFieldLabelKey(fieldKey: string): string | undefined {
  const lineKey = PAYROLL_FIELD_LINE_KEY[fieldKey];
  return lineKey ? PAYROLL_LINE_LABEL_KEY[lineKey] : undefined;
}

export const BUSINESS_PROFILE_GROUP_LABEL_KEY: Record<string, string> = {
  business_scope: CO_UI.businessProfile.groups.business_scope,
  address: CO_UI.businessProfile.groups.address,
  general_info: CO_UI.businessProfile.groups.general_info,
};

const BUSINESS_OPERATION_MODE_LABEL_KEY: Record<string, string> = {
  services: 'clientOperations.businessProfile.operationMode.services',
  trade: 'clientOperations.businessProfile.operationMode.trade',
  online: 'clientOperations.businessProfile.operationMode.online',
  freelancer: 'clientOperations.businessProfile.operationMode.freelance',
  freelance: 'clientOperations.businessProfile.operationMode.freelance',
  manufacturing: 'clientOperations.businessProfile.operationMode.manufacturing',
  mixed: 'clientOperations.businessProfile.operationMode.mixed',
};

const PRIMARY_CUSTOMER_TYPE_LABEL_KEY: Record<string, string> = {
  private: 'clientOperations.businessProfile.customerType.private',
  business: 'clientOperations.businessProfile.customerType.business',
  mixed: 'clientOperations.businessProfile.customerType.mixed',
};

export function businessProfileOptionLabelKey(
  fieldKey: string,
  value: string | number | boolean | null | undefined,
): string | undefined {
  if (fieldKey === 'business_operation_mode') return BUSINESS_OPERATION_MODE_LABEL_KEY[String(value ?? '')];
  if (fieldKey === 'primary_customer_type') return PRIMARY_CUSTOMER_TYPE_LABEL_KEY[String(value ?? '')];
  if (fieldKey === 'is_seasonal_business') {
    if (value === true || value === 'true') return CO_UI.yes;
    if (value === false || value === 'false') return CO_UI.no;
    return undefined;
  }
  if (fieldKey === 'peak_months') {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 1 && n <= 12) return `clientOperations.months.m${n}`;
  }
  return undefined;
}

export const QUICK_PROFILE_ROW_LABEL_KEY: Record<string, string> = {
  client_name: CO_UI.columns.clientName,
  tax_id: CO_UI.columns.taxId,
  business_type: CO_UI.columns.businessType,
  phone: 'clientOperations.fields.phone',
  income_software: 'clientOperations.accounting.blocks.income',
  vat_frequency: CO_UI.taxes.vat,
  income_tax_advances: CO_UI.taxes.incomeTaxAdvances,
  payroll: CO_UI.columns.payroll,
  income_tax_deductions: CO_UI.taxes.incomeTaxDeductions,
  national_insurance_deductions: CO_UI.columns.niDeductions,
  vat_reporting_due_date: 'clientOperations.fees.services.vatReporting',
  income_tax_advances_due_date: 'clientOperations.fees.services.incomeTaxAdvancesReporting',
  income_tax_deductions_due_date: 'clientOperations.fees.services.withholdingReporting',
  national_insurance_deductions_due_date: 'clientOperations.fees.services.nationalInsuranceReporting',
};

export const ANNUAL_DOCUMENT_LABEL_KEY: Record<string, string> = {
  form_106_owner_all_jobs: 'clientOperations.annual.documents.form106Owner',
  form_106_spouse_all_jobs: 'clientOperations.annual.documents.form106Spouse',
  annual_short_income_tax_pension_self: 'clientOperations.annual.documents.pensionSelf',
  annual_short_income_tax_training_fund_self: 'clientOperations.annual.documents.trainingFundSelf',
  withholding_tax_certificate: 'clientOperations.annual.documents.withholdingCert',
  withholding_tax_certificate_securities_867: 'clientOperations.annual.documents.form867',
  inventory_count: 'clientOperations.annual.documents.inventory',
  salary_pricing: 'clientOperations.annual.documents.salaryPricing',
  profit_loss_report: 'clientOperations.annual.documents.profitLoss',
  national_insurance_tax_confirmation: 'clientOperations.annual.documents.niTaxConfirmation',
  national_insurance_pensions_confirmation: 'clientOperations.annual.documents.niPensionsConfirmation',
  national_insurance_reporting_period_confirmation: 'clientOperations.annual.documents.niReportingPeriod',
  national_insurance_payment_confirmation: 'clientOperations.annual.documents.niPayment',
  income_tax_137: 'clientOperations.annual.documents.incomeTax137',
  esna_report: 'clientOperations.annual.documents.esna',
  initial_declaration_copy: 'clientOperations.annual.documents.initialDeclarationCopy',
  bank_accounts_balances: 'clientOperations.annual.documents.bankBalances',
  credit_cards: 'clientOperations.annual.documents.creditCards',
  savings_plans: 'clientOperations.annual.documents.savingsPlans',
  securities: 'clientOperations.annual.documents.securities',
  real_estate: 'clientOperations.annual.documents.realEstate',
  loans: 'clientOperations.annual.documents.loans',
  vehicles: 'clientOperations.annual.documents.vehicles',
  business_assets: 'clientOperations.annual.documents.businessAssets',
  liabilities: 'clientOperations.annual.documents.liabilities',
  cash: 'clientOperations.annual.documents.cash',
  other_assets: 'clientOperations.annual.documents.otherAssets',
};

export const ANNUAL_DOCUMENT_DESCRIPTION_KEY: Record<string, string> = {
  initial_declaration_copy: 'clientOperations.annual.documents.desc.initialDeclarationCopy',
  bank_accounts_balances: 'clientOperations.annual.documents.desc.bankBalances',
  credit_cards: 'clientOperations.annual.documents.desc.creditCards',
  savings_plans: 'clientOperations.annual.documents.desc.savingsPlans',
  securities: 'clientOperations.annual.documents.desc.securities',
  real_estate: 'clientOperations.annual.documents.desc.realEstate',
  loans: 'clientOperations.annual.documents.desc.loans',
  vehicles: 'clientOperations.annual.documents.desc.vehicles',
  business_assets: 'clientOperations.annual.documents.desc.businessAssets',
  liabilities: 'clientOperations.annual.documents.desc.liabilities',
  cash: 'clientOperations.annual.documents.desc.cash',
  other_assets: 'clientOperations.annual.documents.desc.otherAssets',
};

export function documentFolderLabelKey(systemKey: string | null | undefined): string | undefined {
  if (!systemKey) return undefined;
  return CO_UI.documents.folders[systemKey as keyof typeof CO_UI.documents.folders];
}

export const BUSINESS_PROFILE_FIELD_LABEL_KEY: Record<string, string> = {
  business_domain: 'clientOperations.businessProfile.fields.domain',
  business_activity_description: 'clientOperations.businessProfile.fields.activity',
  business_address: 'clientOperations.businessProfile.fields.businessAddress',
  private_address: 'clientOperations.businessProfile.fields.privateAddress',
  business_operation_mode: 'clientOperations.businessProfile.fields.operationMode',
  primary_customer_type: 'clientOperations.businessProfile.fields.customerType',
  is_seasonal_business: 'clientOperations.businessProfile.fields.seasonal',
  peak_months: 'clientOperations.businessProfile.fields.peakMonths',
  business_open_date: 'clientOperations.businessProfile.fields.openDate',
  business_close_date: 'clientOperations.businessProfile.fields.closeDate',
};

export const ACCOUNTING_EXPENSE_LABEL_KEY: Record<string, string> = {
  rent: 'clientOperations.accounting.expenses.rent',
  electricity: 'clientOperations.accounting.expenses.electricity',
  water: 'clientOperations.accounting.expenses.water',
  arnona: 'clientOperations.accounting.expenses.arnona',
  internet: 'clientOperations.accounting.expenses.internet',
  phone: 'clientOperations.accounting.expenses.phone',
  insurance: 'clientOperations.accounting.expenses.insurance',
  software_subscriptions: 'clientOperations.accounting.expenses.softwareSubscriptions',
  bank_fees: 'clientOperations.accounting.expenses.bankFees',
  clearing_fees: 'clientOperations.accounting.expenses.clearingFees',
};

export function quickProfileExpenseLabelKey(expenseTypeCode: string): string | undefined {
  return ACCOUNTING_EXPENSE_LABEL_KEY[expenseTypeCode];
}

export const ACCOUNTING_INCOME_LABEL_KEY: Record<string, string> = {
  business: 'clientOperations.accounting.income.business',
  salary: 'clientOperations.accounting.income.salary',
  pension: 'clientOperations.accounting.income.pension',
  allowance: 'clientOperations.accounting.income.allowance',
  other: 'clientOperations.accounting.income.other',
};

export const ACCOUNTING_DOC_DELIVERY_LABEL_KEY: Record<string, string> = {
  email: 'clientOperations.accounting.docDelivery.email',
  whatsapp: 'clientOperations.accounting.docDelivery.whatsapp',
  upload: 'clientOperations.accounting.docDelivery.upload',
  manual: 'clientOperations.accounting.docDelivery.manual',
  mixed: 'clientOperations.accounting.docDelivery.mixed',
};

export const ACCOUNTING_EXPENSE_DELIVERY_LABEL_KEY: Record<string, string> = {
  external_software: 'clientOperations.accounting.expenseDelivery.externalSoftware',
  email: 'clientOperations.accounting.expenseDelivery.email',
  whatsapp: 'clientOperations.accounting.expenseDelivery.whatsapp',
  nodex_inbox: 'clientOperations.accounting.expenseDelivery.nodexInbox',
  nodexpro_upload: 'clientOperations.accounting.expenseDelivery.nodexproUpload',
  physical_manual: 'clientOperations.accounting.expenseDelivery.physicalManual',
  mixed: 'clientOperations.accounting.expenseDelivery.mixed',
};

export const ACCOUNTING_UPLOADED_BY_LABEL_KEY: Record<string, string> = {
  client: 'clientOperations.accounting.uploadedBy.client',
  office: 'clientOperations.accounting.uploadedBy.office',
  both: 'clientOperations.accounting.uploadedBy.both',
  system_auto: 'clientOperations.accounting.uploadedBy.systemAuto',
  unknown: 'clientOperations.accounting.uploadedBy.unknown',
};

export const ACCOUNTING_ORDER_LABEL_KEY: Record<string, string> = {
  organized: 'clientOperations.accounting.order.organized',
  partial: 'clientOperations.accounting.order.partial',
  messy: 'clientOperations.accounting.order.messy',
};

export const ACCOUNTING_BLOCK_LABEL_KEY: Record<string, string> = {
  expenses: 'clientOperations.accounting.blocks.fixedExpenses',
  income: 'clientOperations.accounting.blocks.income',
  expense_management: 'clientOperations.accounting.blocks.expenses',
  documents: 'clientOperations.accounting.blocks.documents',
  vehicles: 'clientOperations.accounting.blocks.vehicles',
};

export const ACCOUNTING_FIELD_LABEL_KEY: Record<string, string> = {
  expense_software_name: 'clientOperations.accounting.fields.expenseSoftware',
  expense_software_username: 'clientOperations.accounting.fields.expenseUserCode',
  expense_software_password: 'clientOperations.accounting.fields.expensePassword',
  expense_software_url: 'clientOperations.accounting.fields.expenseLink',
  expense_delivery_method: 'clientOperations.accounting.fields.expenseReceipt',
  expense_uploaded_by: 'clientOperations.accounting.fields.expenseUploader',
  expense_documents_order_level: 'clientOperations.accounting.fields.expenseOrder',
  expense_management_notes: 'clientOperations.accounting.fields.expenseNotes',
  income_management_system: 'clientOperations.accounting.fields.software',
  income_user_code: 'clientOperations.accounting.fields.userCode',
  income_password: 'clientOperations.accounting.fields.password',
  income_software_open_link: 'clientOperations.accounting.fields.link',
  license_plate: 'clientOperations.accounting.fields.licensePlate',
  ownership_kind: 'clientOperations.accounting.fields.ownership',
  assigned_to: 'clientOperations.accounting.fields.assignedTo',
  fuel_vat: 'clientOperations.accounting.fields.fuelVat',
};

export const ACCOUNTING_ADDITIONAL_BUSINESS_LABEL_KEY: Record<string, string> = {
  osek_murshe: 'clientOperations.accounting.authorizedShort',
  osek_patur: 'clientOperations.accounting.exemptShort',
  company: 'clientOperations.businessType.company',
};

export const FEE_FIELD_LABEL_KEY: Record<string, string> = {
  has_agreement: 'clientOperations.fees.hasAgreement',
  agreement_start_date: 'clientOperations.fees.agreementStart',
  agreement_end_date: 'clientOperations.fees.agreementEnd',
  auto_renewal: 'clientOperations.fees.autoRenewal',
  billing_day_range: 'clientOperations.fees.billingDate',
  agreement_status: 'clientOperations.fees.agreementStatus',
  discount_has: 'clientOperations.fees.hasDiscount',
  discount_type: 'clientOperations.fees.discountType',
  discount_percent: 'clientOperations.fees.discountPercent',
  discount_amount_ils: 'clientOperations.fees.discountAmount',
  reminder_days_before: 'clientOperations.fees.reminderDays',
  default_end_action: 'clientOperations.fees.endAction',
  end_action_increase_percent: 'clientOperations.fees.increasePercent',
  end_action_increase_amount_ils: 'clientOperations.fees.increaseAmount',
};

export const FEE_CHARGING_LABEL_KEY: Record<string, string> = {
  monthly: 'clientOperations.fees.charging.monthly',
  bi_monthly: 'clientOperations.fees.charging.biMonthly',
  quarterly: 'clientOperations.fees.charging.quarterly',
  yearly: 'clientOperations.fees.charging.yearly',
  one_time: 'clientOperations.fees.charging.oneTime',
};

export const FEE_STATUS_LABEL_KEY: Record<string, string> = {
  active: 'clientOperations.fees.status.active',
  before_renewal: 'clientOperations.fees.status.beforeRenewal',
  expired: 'clientOperations.fees.status.expired',
  in_progress: 'clientOperations.fees.status.inProgress',
  stopped: 'clientOperations.fees.status.stopped',
};

export const FEE_END_ACTION_LABEL_KEY: Record<string, string> = {
  auto_renew_year: 'clientOperations.fees.endActions.autoRenewYear',
  remind_contact_client: 'clientOperations.fees.endActions.remindContactClient',
  increase_price_percent: 'clientOperations.fees.endActions.increasePricePercent',
  increase_price_amount: 'clientOperations.fees.endActions.increasePriceAmount',
};

export const FEE_CHANGE_REASON_LABEL_KEY: Record<string, string> = {
  manual: 'clientOperations.fees.changeReasons.manual',
  agreement_renewal: 'clientOperations.fees.changeReasons.agreementRenewal',
  auto_percent: 'clientOperations.fees.changeReasons.autoPercent',
  auto_amount: 'clientOperations.fees.changeReasons.autoAmount',
  service_added: 'clientOperations.fees.changeReasons.serviceAdded',
  service_removed: 'clientOperations.fees.changeReasons.serviceRemoved',
  service_deactivated: 'clientOperations.fees.changeReasons.serviceDeactivated',
  discount_change: 'clientOperations.fees.changeReasons.discountChange',
  totals_change: 'clientOperations.fees.changeReasons.totalsChange',
  periodic_change: 'clientOperations.fees.changeReasons.periodicChange',
  other: 'clientOperations.fees.changeReasons.other',
};

export const FEE_VAT_MODE_LABEL_KEY: Record<string, string> = {
  before_vat: 'clientOperations.fees.vatExclusive',
  incl_vat: 'clientOperations.fees.vatInclusive',
  vat_exempt: 'clientOperations.fees.vatExempt',
};

export const FEE_CURRENCY_LABEL_KEY: Record<string, string> = {
  ILS: 'clientOperations.fees.currencies.ils',
  USD: 'clientOperations.fees.currencies.usd',
  EUR: 'clientOperations.fees.currencies.eur',
  GBP: 'clientOperations.fees.currencies.gbp',
  CHF: 'clientOperations.fees.currencies.chf',
  CAD: 'clientOperations.fees.currencies.cad',
  AUD: 'clientOperations.fees.currencies.aud',
  JPY: 'clientOperations.fees.currencies.jpy',
  CNY: 'clientOperations.fees.currencies.cny',
  RUB: 'clientOperations.fees.currencies.rub',
  AED: 'clientOperations.fees.currencies.aed',
};

export const FEE_COLUMN_LABEL_KEY: Record<string, string> = {
  service: 'clientOperations.fees.columns.service',
  charging_type: 'clientOperations.fees.columns.chargingType',
  price: 'clientOperations.fees.columns.price',
  qty: 'clientOperations.fees.columns.qty',
  currency: 'clientOperations.fees.columns.currency',
  vat_mode: 'clientOperations.fees.columns.vatMode',
  total: 'clientOperations.fees.columns.total',
  active: 'clientOperations.fees.columns.active',
  service_name: 'clientOperations.fees.columns.serviceName',
  previous_price: 'clientOperations.fees.columns.previousPrice',
  new_price: 'clientOperations.fees.columns.newPrice',
  valid_from: 'clientOperations.fees.columns.validFrom',
  valid_to: 'clientOperations.fees.columns.validTo',
  reason: 'clientOperations.fees.columns.reason',
  updated_by: 'clientOperations.fees.columns.updatedBy',
  changed_at: 'clientOperations.fees.columns.changedAt',
};

export const ANNUAL_TAB_TITLE_KEY: Record<string, string> = {
  annual_report: 'clientOperations.annual.title',
  capital_declaration: 'clientOperations.annual.capitalTitle',
};

export const ANNUAL_DOC_STATUS_LABEL_KEY: Record<string, string> = {
  completed: 'clientOperations.annual.completed',
  checked_only: 'clientOperations.annual.markedMissingFile',
  attached_only: 'clientOperations.annual.fileAttachedNotMarked',
  missing: 'clientOperations.annual.missing',
};

export const ANNUAL_SUBMISSION_STATUS_LABEL_KEY: Record<string, string> = {
  submitted: 'clientOperations.annual.submitted',
  late: 'clientOperations.annual.late',
  extension: 'clientOperations.annual.extended',
  draft: 'clientOperations.annual.draft',
};

export const ANNUAL_CONTROL_STATUS_LABEL_KEY: Record<string, string> = {
  ready: 'clientOperations.annual.readyToSubmit',
  attention: 'clientOperations.annual.urgentAction',
  missing_docs: 'clientOperations.annual.missingDocuments',
};

const COLUMN_LABEL_KEY: Record<string, string> = {
  client_name: CO_UI.columns.clientName,
  tax_id: CO_UI.columns.taxId,
  business_type: CO_UI.columns.businessType,
  payroll: CO_UI.columns.payroll,
  material_brought: CO_UI.columns.material,
  pcn: CO_UI.columns.pcn,
  vat: CO_UI.columns.vat,
  vat_due: CO_UI.columns.vatDue,
  income_tax_advance: CO_UI.columns.incomeTaxAdvance,
  national_insurance: CO_UI.columns.nationalInsurance,
  national_insurance_deductions: CO_UI.columns.niDeductions,
  income_tax_deductions: CO_UI.columns.incomeTaxDeductions,
  annual_report: CO_UI.columns.annualReport,
  capital_declaration: CO_UI.columns.capitalDeclaration,
  handler: CO_UI.columns.handler,
  notes: CO_UI.columns.notes,
};

const TOOLBAR_LABEL_KEY: Record<string, string> = {
  undo: CO_UI.toolbar.undo,
  redo: CO_UI.toolbar.redo,
  search: CO_UI.toolbar.search,
  filter: CO_UI.toolbar.filter,
  sort_asc: CO_UI.toolbar.sortAsc,
  sort_desc: CO_UI.toolbar.sortDesc,
  align_right: CO_UI.toolbar.alignRight,
  align_center: CO_UI.toolbar.alignCenter,
  align_left: CO_UI.toolbar.alignLeft,
  wrap_text: CO_UI.toolbar.wrapText,
  bold: CO_UI.toolbar.bold,
  italic: CO_UI.toolbar.italic,
  underline: CO_UI.toolbar.underline,
  text_color: CO_UI.toolbar.textColor,
  fill_color: CO_UI.toolbar.fillColor,
  number_format: CO_UI.toolbar.numberFormat,
  borders: CO_UI.toolbar.borders,
  freeze_columns: CO_UI.toolbar.freezeColumns,
  toggle_columns: CO_UI.toolbar.toggleColumns,
  fullscreen: CO_UI.toolbar.fullscreen,
  add_column: CO_UI.toolbar.addColumn,
};

const FILTER_LABEL_KEY: Record<string, string> = {
  operational_reporting: CO_UI.filters.reporting,
  material: CO_UI.filters.material,
  payroll: CO_UI.filters.payroll,
  reporting_type: CO_UI.filters.reportingType,
  business_type: CO_UI.filters.businessType,
  handler: CO_UI.filters.handler,
  clear_filters: CO_UI.clearFilter,
};

const FILTER_OPTION_LABEL_KEY: Record<string, string> = {
  all: CO_UI.all,
  reported: CO_UI.filters.reported,
  not_reported: CO_UI.filters.notReported,
  received: CO_UI.filters.received,
  not_received: CO_UI.filters.notReceived,
  has_payroll: CO_UI.filters.hasPayroll,
  no_payroll: CO_UI.filters.noPayroll,
  unassigned: CO_UI.filters.unassigned,
  income_tax_advance_monthly: CO_UI.filters.itaMonthly,
  income_tax_advance_bimonthly: CO_UI.filters.itaBimonthly,
  income_tax_advance_exempt: CO_UI.filters.itaExempt,
  vat_monthly: CO_UI.filters.vatMonthly,
  vat_bimonthly: CO_UI.filters.vatBimonthly,
  income_tax_deductions_monthly: CO_UI.filters.itdMonthly,
  income_tax_deductions_bimonthly: CO_UI.filters.itdBimonthly,
  income_tax_deductions_semiannual: CO_UI.filters.itdSemiannual,
  osek_murshe: CO_UI.businessType.osekMurshe,
  osek_patur: CO_UI.businessType.osekPatur,
  company: CO_UI.businessType.company,
  undefined: CO_UI.businessType.unset,
};

const STORED_BUSINESS_TYPE_LABEL_KEY: Record<string, string> = {
  'עוסק פטור': CO_UI.businessType.osekPatur,
  'עוסק מורשה': CO_UI.businessType.osekMurshe,
  חברה: CO_UI.businessType.company,
  תאגיד: CO_UI.businessType.corporation,
  אחר: CO_UI.businessType.other,
};

const SYSTEM_DISPLAY_TOKEN_KEY: Record<string, string> = {
  כן: CO_UI.yes,
  לא: CO_UI.no,
  חודשי: CO_UI.enums.monthly,
  'חד חודשי': CO_UI.enums.monthly,
  'דו-חודשי': CO_UI.enums.biMonthly,
  'דו חודשי': CO_UI.enums.biMonthly,
  'חצי שנתי': CO_UI.enums.semiAnnual,
  'חצי-שנתי': CO_UI.enums.semiAnnual,
  'לא רלוונטי': CO_UI.enums.notRelevant,
  'לא עונה להגדרות': CO_UI.enums.notApplicable,
  פטור: CO_UI.enums.exempt,
  רגיל: CO_UI.enums.regular,
  אשראי: CO_UI.enums.credit,
  'הוראת קבע': CO_UI.enums.standingOrder,
  שובר: CO_UI.enums.voucher,
  אחר: CO_UI.enums.other,
  בחר: CO_UI.choose,
  ...STORED_BUSINESS_TYPE_LABEL_KEY,
};

const SKIP_CELL_KEYS = new Set([
  'client_name',
  'tax_id',
  'handler',
  'notes',
  'vat_due',
  'annual_report',
  'capital_declaration',
  'pcn',
  'folder',
]);

export function registryColumnLabelKey(columnKey: string): string | undefined {
  return COLUMN_LABEL_KEY[columnKey];
}

export function toolbarCapabilityLabelKey(capabilityId: string): string | undefined {
  return TOOLBAR_LABEL_KEY[capabilityId];
}

export function registryFilterLabelKey(filterId: string): string | undefined {
  return FILTER_LABEL_KEY[filterId];
}

export function registryFilterOptionLabelKey(optionId: string): string | undefined {
  return FILTER_OPTION_LABEL_KEY[optionId];
}

export function storedBusinessTypeLabelKey(stored: string | null | undefined): string | undefined {
  const normalized = String(stored ?? '')
    .replace(/\u00a0/g, ' ')
    .trim();
  return STORED_BUSINESS_TYPE_LABEL_KEY[normalized];
}

export function knownSystemDisplayLabelKey(display: string | null | undefined): string | undefined {
  const normalized = String(display ?? '')
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!normalized || normalized === '—') return undefined;
  return SYSTEM_DISPLAY_TOKEN_KEY[normalized];
}

export function buildRegistryRowCellLabelKeys(cells: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(cells)) {
    if (SKIP_CELL_KEYS.has(key)) continue;
    const labelKey = key === 'business_type' ? storedBusinessTypeLabelKey(value) : knownSystemDisplayLabelKey(value);
    if (labelKey) out[key] = labelKey;
  }
  return out;
}

/** Obligations table columns — keyed by column `key`, not Hebrew text. */
export const OBLIGATION_COLUMN_LABEL_KEY: Record<string, string> = {
  payroll: CO_UI.obligations.columns.payroll,
  material: CO_UI.obligations.columns.materialBrought,
  vat: CO_UI.obligations.columns.vat,
  vat_due_day: CO_UI.obligations.columns.vatDue,
  income_advances: CO_UI.obligations.columns.incomeTaxAdvances,
  ni: CO_UI.obligations.columns.nationalInsurance,
  ni_deductions: CO_UI.obligations.columns.niDeductions,
  income_tax_deductions: CO_UI.obligations.columns.incomeTaxDeductions,
  priority: CO_UI.obligations.columns.priority,
};

export const OBLIGATION_CHECKBOX_LABEL_KEY: Record<string, string> = {
  vat: CO_UI.obligations.columns.vat,
  income_advances: CO_UI.obligations.advances,
  payroll: CO_UI.obligations.columns.payroll,
};

export function obligationColumnLabelKey(columnKey: string): string | undefined {
  return OBLIGATION_COLUMN_LABEL_KEY[columnKey];
}

export function obligationCheckboxLabelKey(checkboxKey: string): string | undefined {
  return OBLIGATION_CHECKBOX_LABEL_KEY[checkboxKey];
}

export const HISTORY_FEE_COMMAND_SUMMARY_KEY: Record<string, string> = {
  update_fee_agreement: CO_UI.history.summaries.feeAgreementUpdated,
  add_fee_service_line: CO_UI.history.summaries.feeServiceLineAdded,
  update_fee_service_line: CO_UI.history.summaries.feeServiceLineUpdated,
  remove_fee_service_line: CO_UI.history.summaries.feeServiceLineRemoved,
  add_custom_fee_service_line: CO_UI.history.summaries.feeCustomLineAdded,
  update_custom_fee_service_line: CO_UI.history.summaries.feeCustomLineUpdated,
  remove_custom_fee_service_line: CO_UI.history.summaries.feeCustomLineRemoved,
};

export const HISTORY_DOCUMENT_COMMAND_SUMMARY_KEY: Record<string, string> = {
  initialize_client_document_folders: CO_UI.history.summaries.documentsInitialized,
  create_client_document_folder: CO_UI.history.summaries.documentsFolderCreated,
  rename_client_document_folder: CO_UI.history.summaries.documentsFolderRenamed,
  archive_or_delete_client_document_folder: CO_UI.history.summaries.documentsFolderArchived,
  upload_client_document: CO_UI.history.summaries.documentsUploaded,
  delete_client_document: CO_UI.history.summaries.documentsDeleted,
};

export const HISTORY_OBLIGATION_ACTION_KEYS: Record<string, { button: string; result: string }> = {
  mark_ni_paid: { button: CO_UI.obligations.paid, result: 'clientOperations.history.results.markedPaid' },
  mark_ni_not_paid: { button: CO_UI.obligations.stillUnpaid, result: 'clientOperations.history.results.markedUnpaid' },
  mark_ni_not_relevant: { button: CO_UI.obligations.notRelevant, result: 'clientOperations.history.results.markedNotRelevant' },
  set_ni_standing_order: {
    button: CO_UI.obligations.standingOrder,
    result: 'clientOperations.history.results.standingOrderUpdated',
  },
  update_ni_payment_amount: {
    button: CO_UI.obligations.updateAmount,
    result: 'clientOperations.history.results.amountUpdated',
  },
  set_ni_deductions_reminder_suppressed: {
    button: CO_UI.obligations.dontShowThisMonth,
    result: 'clientOperations.history.results.niReminderSuppressed',
  },
  set_ni_deductions_step: {
    button: 'clientOperations.history.buttons.niDeductionsStep',
    result: 'clientOperations.history.results.niDeductionsStepUpdated',
  },
  mark_ni_deductions_payroll_in_progress: {
    button: CO_UI.obligations.payrollInProgress,
    result: 'clientOperations.history.results.payrollFollowUp',
  },
  mark_ni_deductions_reported_and_paid: {
    button: CO_UI.obligations.reportedAndPaid,
    result: 'clientOperations.history.results.markedReportedPaidDeductions',
  },
  mark_ni_deductions_not_relevant: {
    button: CO_UI.obligations.notRelevant,
    result: 'clientOperations.history.results.markedNotRelevantDeductions',
  },
  touch_ni_deductions_auto_reminder_shown: {
    button: 'clientOperations.history.buttons.niDeductionsAutoReminder',
    result: 'clientOperations.history.results.reminderShown',
  },
  set_payroll_period_salary_data_received: {
    button: CO_UI.obligations.salaryDataReceived,
    result: 'clientOperations.history.results.payrollStepUpdated',
  },
  set_payroll_period_sent_to_employer: {
    button: CO_UI.obligations.salariesSentToEmployer,
    result: 'clientOperations.history.results.payrollStepUpdated',
  },
  set_payroll_period_no_salaries: {
    button: CO_UI.obligations.noPayrollThisMonth,
    result: 'clientOperations.history.results.payrollStepUpdated',
  },
  mark_payroll_period_not_relevant: {
    button: 'clientOperations.history.buttons.payrollNotRelevant',
    result: 'clientOperations.history.results.payrollPeriodNotRelevant',
  },
  mark_obligation_reported: {
    button: CO_UI.obligations.markSubmitted,
    result: 'clientOperations.history.results.markedSubmitted',
  },
  mark_obligation_reported_and_paid: {
    button: CO_UI.obligations.markSubmittedAndPaid,
    result: 'clientOperations.history.results.markedSubmittedPaid',
  },
  mark_obligation_not_reported: {
    button: CO_UI.obligations.markNotReported,
    result: 'clientOperations.history.results.markedNotReported',
  },
  notify_client_payment_amount: {
    button: CO_UI.obligations.updateAmount,
    result: 'clientOperations.history.results.paymentAmountSent',
  },
  send_docflow_request: {
    button: CO_UI.obligations.requestDocuments,
    result: 'clientOperations.history.results.requestSentToClient',
  },
  approve_docflow_reminder_send: {
    button: 'clientOperations.history.buttons.approveSend',
    result: 'clientOperations.history.results.requestApprovedSent',
  },
  dismiss_docflow_reminder: {
    button: 'clientOperations.history.buttons.dismissRequest',
    result: 'clientOperations.history.results.requestCancelled',
  },
  mark_material_received: {
    button: CO_UI.obligations.markMaterialReceived,
    result: 'clientOperations.history.results.materialReceived',
  },
  mark_salary_data_received: {
    button: CO_UI.obligations.markSalaryReceived,
    result: 'clientOperations.history.results.salaryReceived',
  },
  mark_income_data_received: {
    button: CO_UI.obligations.markIncomeReceived,
    result: 'clientOperations.history.results.incomeReceived',
  },
  mark_material_not_relevant: {
    button: CO_UI.obligations.notRelevant,
    result: 'clientOperations.history.results.markedNotRelevant',
  },
  mark_salary_data_not_relevant: {
    button: CO_UI.obligations.notRelevant,
    result: 'clientOperations.history.results.markedNotRelevant',
  },
  mark_income_data_not_relevant: {
    button: CO_UI.obligations.notRelevant,
    result: 'clientOperations.history.results.markedNotRelevant',
  },
};

export const HISTORY_TASK_ACTION_KEYS: Record<string, { button: string; result: string }> = {
  resolve_task: {
    button: CO_UI.history.buttons.resolveTask,
    result: CO_UI.history.results.taskClosed,
  },
  snooze_task: {
    button: CO_UI.history.buttons.snoozeTask,
    result: CO_UI.history.results.taskSnoozed,
  },
  reopen_task: {
    button: CO_UI.history.buttons.reopenTask,
    result: CO_UI.history.results.taskReopened,
  },
};
