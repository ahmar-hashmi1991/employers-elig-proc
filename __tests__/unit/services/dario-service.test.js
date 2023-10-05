const db = require('../../../src/services/rds-data-service');
const dario = require('../../../src/services/dario-service');

const DEFAULT_ELIG_RULES = {
    "productTypes": ["BP"],
    "validationFields": ["reseller_employee_id", "role", "dob"],
    "membershipDisabled": { "membership_plan": "", "clinic": "", "clinic_meta": { "channel": "", "sub_channel": "" }, "display_name": "", "checkup_call_expert": "", "contact_us_email": "", "contact_us_phone": "" }
};
const DEFAULT_MAPPING_RULES = { "FirstName": "first_name", "LastName": "last_name", "Email Address": "email", "Phone Number": "phone", "Employee ID": "employee_id", "Vitality ID": "reseller_employee_id", "Role": "role", "Gender": "gender", "Date of Birth": { "key": "dob", "transform": "date:'MM/DD/YYYY'" }, "Branch": "branch", "Group Name": "group_name" };
const DEFAULT_EMPLOYER = { employer_id: 23, external_id: '99999', mapping_rules: DEFAULT_MAPPING_RULES, eligibility_rules: JSON.stringify(DEFAULT_ELIG_RULES) };

// TODO: Refactor to single object and modifying of it in each test according to required response
const CREATE_USER_RESPONSE_FULL_DATA = {
    "email": "test@mail.com",
    "password": "jestTest",
    "first_name": "TestFirstName",
    "last_name": "TestLastName",
    "srgn": "US",
    "slng": "en",
    "relation": "EE",
    "is_minor": false,
    "parent_email": "test@mail.com",
    "eid": "a4b0da5b-47d0-4a6b-8162-6ceb6bff1e1a",
    "employer_id": "99999",
    "weight": 60,
    "height": 1.70,
    "hba1c": 23,
    "last_fasting_bg": 32,
    "gender": "F",
    "dob": "01/31/1989",
    "phone_number": "+380637777777"
};
const CREATE_USER_RESPONSE_WITHOUT_WEIGHT_AND_HEIGT = {
    "email": "test@mail.com",
    "password": "jestTest",
    "first_name": "TestFirstName",
    "last_name": "TestLastName",
    "srgn": "US",
    "slng": "en",
    "relation": "EE",
    "is_minor": false,
    "parent_email": "test@mail.com",
    "eid": "a4b0da5b-47d0-4a6b-8162-6ceb6bff1e1a",
    "employer_id": "99999",
    "hba1c": 23,
    "last_fasting_bg": 32,
    "gender": "F",
    "dob": "01/31/1989",
    "phone_number": "+380637777777"
};
const CREATE_USER_RESPONSE_WITH_MRN = {
    "email": "test@mail.com",
    "password": "jestTest",
    "first_name": "TestFirstName",
    "last_name": "TestLastName",
    "srgn": "US",
    "slng": "en",
    "relation": "EE",
    "is_minor": false,
    "parent_email": "test@mail.com",
    "eid": "a4b0da5b-47d0-4a6b-8162-6ceb6bff1e1a",
    "mrn": "VSC12345678",
    "employer_id": "99999",
    "weight": 60,
    "height": 1.70,
    "hba1c": 23,
    "last_fasting_bg": 32,
    "gender": "F",
    "dob": "01/31/1989",
    "phone_number": "+380637777777"
};

// Mocks functions
const dbMocks = () => {
    db.beginTransaction = jest.fn();
    db.commit = jest.fn();
    db.rollback = jest.fn();
    db.end = jest.fn();

    db.getEmployerByID = jest.fn().mockResolvedValue([[DEFAULT_EMPLOYER]]);
}

describe('User creation for dario service (metabloic backend/PHP backend)', () => {
    beforeAll(() => {
        console.log = jest.fn();
        dbMocks();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('Successfully creates user with all data', async () => {
        const body = await dario.createDarioUser(
            'test@mail.com',
            'TestFirstName',
            'TestLastName',
            '+380637777777',
            'en',
            'US',
            'EE',
            false,
            'test@mail.com',
            'a4b0da5b-47d0-4a6b-8162-6ceb6bff1e1a',
            'VSC12345678',
            '23',
            {
                weight: 60,
                height: 1.70,
                hba1c: 23,
                last_fasting_bg: 32
            },
            'F',
            '01/31/1989'
        );

        expect(db.getEmployerByID).toHaveBeenCalledTimes(1);
        expect(body).toEqual(CREATE_USER_RESPONSE_FULL_DATA);
    });

    it('Successfully creates user without weight and height', async () => {
        const body = await dario.createDarioUser(
            'test@mail.com',
            'TestFirstName',
            'TestLastName',
            '+380637777777',
            'en',
            'US',
            'EE',
            false,
            'test@mail.com',
            'a4b0da5b-47d0-4a6b-8162-6ceb6bff1e1a',
            'VSC12345678',
            '23',
            {
                hba1c: 23,
                last_fasting_bg: 32
            },
            'F',
            '01/31/1989'
        );

        expect(db.getEmployerByID).toHaveBeenCalledTimes(1);
        expect(body).toEqual(CREATE_USER_RESPONSE_WITHOUT_WEIGHT_AND_HEIGT);
    });

    it('Successfully creates user with MRN', async () => {
        const EMPLOYER = DEFAULT_EMPLOYER;
        const ELIGIBILITY_RULES = JSON.parse(EMPLOYER.eligibility_rules);
        ELIGIBILITY_RULES.membership = {
            mrn: "jestMRNTest"
        }
        EMPLOYER.eligibility_rules = JSON.stringify(ELIGIBILITY_RULES);

        db.getEmployerByID = jest.fn().mockReset();
        db.getEmployerByID = jest.fn().mockResolvedValue([[EMPLOYER]]);

        const body = await dario.createDarioUser(
            'test@mail.com',
            'TestFirstName',
            'TestLastName',
            '+380637777777',
            'en',
            'US',
            'EE',
            false,
            'test@mail.com',
            'a4b0da5b-47d0-4a6b-8162-6ceb6bff1e1a',
            'VSC12345678',
            '23',
            {
                weight: 60,
                height: 1.70,
                hba1c: 23,
                last_fasting_bg: 32
            },
            'F',
            '01/31/1989'
        );

        expect(db.getEmployerByID).toHaveBeenCalledTimes(1);
        expect(body).toEqual(CREATE_USER_RESPONSE_WITH_MRN);
    })
})