const constants = {
    EligibilityStatus: {
        ELIGIBLE: 'eligible',
        INELIGIBLE: 'ineligible',
        ENROLLED: 'enrolled'
    },
    EligibilityStage: {
        NEW: 'new',
        HR_EMAIL_SENT: 'HR email sent',
        BRAZE_FLOW: 'Braze flow',
        CALL_CENTER: 'call center',
        SNAIL_MAIL: 'snail mail',
        ENROLLED: 'enrolled',
        SHIPPED: 'shipped',
        DELIVERED: 'delivered',
        ACTIVATION: 'activation',
        INELIGIBLE: 'ineligible',
        GRACE_STARTED: 'grace started',
        GRACE_REMOVED: 'grace removed',
        CANCELLED: 'canceled'
    },
    EligibilityRole: {
        EMPLOYEE: 'EE',
        CHILD: 'CH'
    },
    EligibilityTargeting: {
        ENABLED: 1,
        DISABLED: 0
    },
    FileLogStatus: {
        NEW: 'new',
        FILE_SUCCESS: 'file-success',
        SUCCESS: 'success',
        SUCCESS_RECON: 'success-reconciliation',
        ERROR: 'error'
    },
    EligibilityLogAction: {
        UPDATE: 'update'
    },
    EligibilityWorkerAction: {
        ADD: 'add',
        UPDATE: 'update',
        REMOVE: 'remove',
        GRACE: 'grace',
        UNGRACE: 'ungrace',
        FINISH: 'finish',
        ORDER: 'order',
        EXTERNAL_SERVICES: 'external_services',
        REMOVE_EXTERNAL_SERVICES: 'remove_external_services',
        UPDATE_EXTERNAL_SERVICES: 'update_external_services',
        CREATE_ELIBIGILITY_IN_REFERRALS: 'create_eligibility_in_referrals'
    },
    Braze: {
        NEW: 'employer_eligibility_added',
        ENABLED: 'employer_eligibility_enabled',
        REVOKED: 'employer_eligibility_revoked',
        UPDATE: 'employer_eligibility_update',
        ENROLLED_OTHER: 'eligibility_enrolled_other_user',
        MINOR_ENROLLED: 'child_enrolled',
        MINOR_B2B: 'b2b_minors',
        CREATE_ORDER: 'eligibility_confirmed'
    },
    BrazeSolera: {
        M2_MILESTONE: 'm2_milestone_completed',
        M3_MILESTONE: 'm3_milestone_completed',
        M4_MILESTONE: 'm4_milestone_completed',
        M5_MILESTONE: 'm5_milestone_completed',
        M5A_MILESTONE: 'm5a_milestone_completed',
        M5B_MILESTONE: 'm5b_milestone_completed',
        M5C_MILESTONE: 'm5c_milestone_completed',
        M5D_MILESTONE: 'm5d_milestone_completed'
    },
    EmployerStatus: {
        ACTIVE: 'active',
        INACTIVE: 'inactive'
    },
    Behaviors: {
        AUTO_CREATE: 'autoCreateEligibility',
        ADD_ELIGIBLE_BY_RPM: 'clinic_admin',
        DECRYPT_PGP: 'decryptPGP',
        REENROLLMENT: 'reenrollment',
        DUPLICATE_PHONE: 'duplicatePhone'
    },
    FileParser:{
        DEFAULT: 'papaParseFile',
        FIXED_WIDTH: 'fixedWidthParseFile',
        MULTILINE_DEPENDENTS: 'multilineDependentsParseFile'
    },
    matchMultipleFilesByFunction: {
        DEFAULT: 'matchDataByUniquePrimaryKey',
        GROUP_KEY: 'orderDataByPrimaryGroupKeyAndFileName'
    },
    ClaimsFileStatus: {
        NEW: 'new',
        PROCESSING: 'processing',
        SUCCESS: 'success',
        FAILURE: 'failure'
    },
    ProcessingPolicy: {
        KEEP_FIRST: 'keepFirst',
        KEEP_LAST: 'keepLast'
    },
    baseEligibilityFields: {
        first_name: 'first_name',
        postcode: 'zipcode',
        country: 'country',
        last_name: 'last_name',
        gender: 'gender',
        dob: 'dob',
        email: 'email',
        phone: 'phone',
        city: 'city',
        address_1: 'address_1'
    },
    RedeemedProductStatus: {
        ENROLLED: 'enrolled',
        DISENROLLED: 'disenrolled',
        REENROLLED: 'reenrolled'
    },
    ProductType: {
        BG: 'BG',
        BP: 'BP',
        MSK: 'MSK',
        WM: 'WM',
        PST: 'PST',
        MSK_PST: 'MSK_PST',
    },
    B2CAccountId:10000,
    MembershipOnlySKUs : {
        eligibility_mo_wm_gsm_sku: 'ELG-WM-00000-7500-moMC',
        eligibility_mo_msk_pst_sku: 'ELG-MSKUPRIGHT-00000-7800-moMC',
        eligibility_mo_pst_sku: 'ELG-UPRIGHT-00000-7700-moMC',
        eligibility_mo_msk_cva_sku: 'ELG-MSK-00000-7400-moMC',
        eligibility_mo_bp_gsm_sku: 'ELG-HT-00000-7300-moMC',
        eligibility_mo_ig_sku: 'ELG-00000-7200-moMC'
    },
    ENROLLMENT_API_SETTINGS:{
        API_RATE_LIMIT_IN_SECONDS:120,
        API_REDIS_KEY:'ENROLLMENT'
    },
    MembershipOnlySKUsKeys : {
        BG: {iphone:"eligibility_iphone_sku",usbc: "eligibility_usbc_sku",ig:"eligibility_ig_sku", aj: "eligibility_aj_sku"},
        BP: "eligibility_bp_gsm_sku",
        MSK: "eligibility_msk_cva_sku",
        WM: "eligibility_wm_gsm_sku",
        PST: "eligibility_pst_sku",
        MSK_PST: "eligibility_msk_pst_sku"
    }


};

module.exports = Object.freeze(constants);
