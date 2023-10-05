const db = require('../../../src/services/rds-data-service');
const shop = require('../../../src/services/shop-service');
const constants = require('../../../src/common/constants');

const { RedeemedProductStatus, Behaviors, ProductType } = constants;
const { REENROLLED } = RedeemedProductStatus;
const { BG, BP } = ProductType;

const ONLY_MEMBERSHIP_SKU = {
    BG: 'ELG-00000-7200-moMC',
    BP: 'ELG-HT-00000-7300-moMC',
    MSK: 'ELG-MSK-00000-7400-moMC',
    WM: 'ELG-WM-00000-7500-moMC',
    PST: 'ELG-UPRIGHT-00000-7700-moMC',
    MSK_PST: 'ELG-MSKUPRIGHT-00000-7800-moMC',
};

const MOCK = {
    EMPLOYER: {
        eligibility_rules: {
            behaviors: [Behaviors.REENROLLMENT],
            membershipSKU: ONLY_MEMBERSHIP_SKU,
        },
    },
    REDEEMED_PRODUCTS: [ { status: REENROLLED, product_type: BG, }, { status: REENROLLED, product_type: BP, } ],
    EMPLOYEE: { id: 'employee_id' },
};

const ORDER_BEFORE = {
    api_data: { eid: 'test_eid' },
    user_data: {},
    emp_set: {
        products: {
            bg: { iphone: "ELG-00000-7200-lcMC", usbc: "ELG-00000-7200-ucMC", aj: "", ig: "ELG-00000-7200-igMC" },
            bp: { m: "", l: "", gsm: "ELG-HT-00000-7300-MC" },
            msk: { default: "" },
            pst: { default: "" },
            msk_pst: { default: "ELG-MSKUPRIGHT-00000-7800-MC" },
            msk_cva: { default: "" },
            bh: { default: "ELG-BH-00000-7600-MC" },
            eap: { default: "" },
            wm: { gsm: "ELG-WM-00000-7500-MC" }
        },
    },
    products_json : {
        "BG": "usbc",
        "BP": "gsm",
        "wm": "gsm"
    }
};

const ORDER_AFTER = {
    ...ORDER_BEFORE,
    emp_set: {
        products: {
            ...ORDER_BEFORE.emp_set.products,
            bg: { iphone: ONLY_MEMBERSHIP_SKU.BG, usbc: ONLY_MEMBERSHIP_SKU.BG, aj: ONLY_MEMBERSHIP_SKU.BG, ig: ONLY_MEMBERSHIP_SKU.BG },
            bp: { m: ONLY_MEMBERSHIP_SKU.BP, l: ONLY_MEMBERSHIP_SKU.BP, gsm: ONLY_MEMBERSHIP_SKU.BP },
        },
        eligibility_aj_sku: "ELG-00000-7200-moMC",
        eligibility_bp_gsm_sku: "ELG-HT-00000-7300-moMC",
        eligibility_ig_sku: "ELG-00000-7200-moMC",
        eligibility_iphone_sku: "ELG-00000-7200-moMC",
        eligibility_usbc_sku: "ELG-00000-7200-moMC"
    },
};

const dbMocks = () => {
    db.getEmployerByExternalID = jest.fn().mockResolvedValue(MOCK.EMPLOYER);
    db.getEligibility = jest.fn().mockResolvedValue([[MOCK.EMPLOYEE]]);
    db.getRedeemedProductsList = jest.fn().mockResolvedValue([MOCK.REDEEMED_PRODUCTS]);
};

describe('Order handling for shop service (dario shop backend/PHP backend)', () => {
    beforeAll(() => {
        dbMocks();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('Successfully updates membership SKU for reenrolled products', async () => {
        await shop.modifyOrderDataForReenrolledUser(ORDER_BEFORE)
        expect(ORDER_BEFORE).toEqual(ORDER_BEFORE);
    });
    
    it('Successfully updates membership SKU for reenrolled products with manualreenrollment flag', async () => {
        ORDER_BEFORE.user_data.isManualReEnrollment = true
        ORDER_BEFORE.api_data.eligible_products = {
            BG: false,
            BP: false,
            WM: true,
            MSK: true,
            BH: true,
            PST: true,
            MSK_PST: true
          } 
        await shop.modifyOrderDataForReenrolledUser(ORDER_BEFORE)
        expect(ORDER_BEFORE).toEqual(ORDER_AFTER);
    });
    it('Successfully updates membership SKU for reenrolled products with newReenroledProducts flag', async () => {
        ORDER_BEFORE.user_data.newReenroledProducts = true
        ORDER_BEFORE.user_data.isManualReEnrollment = true
        ORDER_BEFORE.api_data.eligible_products = {
            BG: false,
            BP: false,
            WM: true,
            MSK: true,
            BH: true,
            PST: true,
            MSK_PST: true
          } 
        await shop.modifyOrderDataForReenrolledUser(ORDER_BEFORE)
        expect(ORDER_BEFORE).toEqual(ORDER_AFTER);
    });
});
