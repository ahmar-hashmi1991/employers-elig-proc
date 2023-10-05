const db = require('../../../src/services/rds-data-service');
const dario = require('../../../src/services/dario-service');
// const secrets = require('../../../src/services/secrets-service');

const todayForEligibility = new Date().toISOString().substring(0,10);

const elig_rule = {"validation": false,"update_limit": 13168,"skipIfMinor": false,"productTypes": [    "BP"],"validationFields": [    "first_name",    "last_name",    "dob",    "gender"],"targeting": {    "default": false,    "minor_age": 18},"provisioning": {    "dario": true},"membership": {
    "membership_plan": "MEMBER_B2B",
    "clinic": "120",
    "clinic_meta": {
        "channel": "CF Industries",
        "sub_channel": "CF Industries"
    },
    "display_name": "CF Industries",
    "checkup_call_expert": "expert2",
    "contact_us_email": "service@dariohealth.com","contact_us_phone": "1-888-408-4125","activate_grocery_scanner": false,"activate_healthkit_observers": false}};
const EMPLOYER = { "id": 23, "reseller_id": 1, "external_id": '12345', "eligibility_rules": elig_rule };
const ELIGIBILITY = { "id": 246, "eid": "68c7d7da-5f6e-4abb-8e41-20a2edd6f7aa", "employer_id": 23, "first_name": "margo", "last_name": "test", "email": "testqa+hrblock083@mydario.com", "phone": "+17015550781", "shop_phone": null, "gender": "M", "dob": todayForEligibility, "status": "eligible", "stage": "new", "employee_id": "123682", "reseller_employee_id": "VS00123683", "role": "DP", "group_name": "ABC COMPANY", "branch": "TEST", "sf_id": "0011q00000bhEATAA2", "braze_id": null, "dario_app_uid": null, "app_email": null, "created_at": "2020-09-23T12:21:57.000Z", "updated_at": "2020-09-23T12:21:57.000Z", "attribute_1": null, "attribute_2": null, "attribute_3": null, "attribute_4": null, "attribute_5": null };
const SHOP_DATA = {
    "phone": '+17015550781',
    "email": 'testqa+hr026@mydario.com',
    "country": 'US',
    "orders": [ [Object] ],
    "eligibility_id": '68c7d7da-5f6e-4abb-8e41-20a2edd6f7aa',
    "employer_id": '23',
    "state": 'verified',
    "zipcode": '78660',
    "b2b": { "goals": 'WM', "height": `4' 11"`, "weight": 200 },
    "actions": { "goals": 'wm_filter', "height": 'ft', "weight": 'lb' }
  };

const dbDefaultMocks = () => {
    db.beginTransaction = jest.fn();
    db.commit = jest.fn();
    db.rollback = jest.fn();
    db.end = jest.fn();
};

describe('Test for deleting minor link', () => {
    beforeAll(() => {
        dbDefaultMocks();

        db.getEmployerMinorTargetingList = jest.fn().mockResolvedValue([[EMPLOYER], []]);
        db.getEmployerMinorTerminationLinkList = jest.fn().mockResolvedValue([ELIGIBILITY, []]);
        dario.removeMinorLink = jest.fn().mockResolvedValue({
            "status":200,
            "error": {
                "code": 0,
                "description": "ok"
            }
        })
        //omit logging
        console.log = jest.fn();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('Verifies <cronTerminateMinorUserLinkHandler>', async () => {
        const apiHandler = require('../../../src/handlers/dario-user-handler');
        await apiHandler.cronTerminateMinorUserLinkHandler();
        expect(db.getEmployerMinorTargetingList).toHaveBeenCalledTimes(1);
        expect(db.getEmployerMinorTerminationLinkList).toHaveBeenCalledTimes(1);
        expect(dario.removeMinorLink).toHaveBeenCalledTimes(1);
        expect(dario.removeMinorLink).toHaveBeenCalledWith(
            'testqa+hrblock083@mydario.com'
        );
    });
});

describe('Test for creating user in Dario backend', () => {
    beforeAll(() => {
        const employer = EMPLOYER;
        employer.eligibility_rules = JSON.stringify(employer.eligibility_rules);

        dbDefaultMocks();
        
        db.getEmployerByID = jest.fn().mockResolvedValue([[EMPLOYER]]);

        db.updateEligibilityAppEmail = jest.fn().mockResolvedValue({
            "status": 200,
            "error": { "code": 0, "description": 'ok' },
            "user_secret": 'befc56964bcb88b47c45f783b79b6129',
            "osid": 989859,
            "uid": 11256
        });
        db.updateEligibilityAppUserId = jest.fn().mockResolvedValue({});

        dario.createDarioUser = jest.fn().mockResolvedValue({
            statusCode: 200,
            body: {
                status: 200,
                error: { code: 0, description: 'ok' },
                user_secret: 'befc56964bcb88b47c45f783b79b6129',
                osid: 989859,
                uid: 11256
              }
        });

        // secrets.getSecret = jest.fn().mockResolvedValue({ apikey: 'unittest' });

        //omit logging
        console.log = jest.fn();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('Verifies <createDarioUser>', async () => {
        const eligibility = ELIGIBILITY;
        eligibility.role = "EE";
        const event = {
            eligibility: ELIGIBILITY,
            shopdata: SHOP_DATA
        }
        const apiHandler = require('../../../src/handlers/dario-user-handler');
        await apiHandler.CreateDarioUser(event, undefined);

        expect(dario.createDarioUser).toHaveBeenCalledTimes(1);
        expect(dario.createDarioUser).toHaveBeenCalledWith(
            "testqa+hrblock083@mydario.com", 
            "margo", 
            "test", 
            "+17015550781", 
            "en", 
            "US", 
            "EE", 
            false, 
            undefined, 
            "68c7d7da-5f6e-4abb-8e41-20a2edd6f7aa", 
            "VS00123683", 
            23, 
            {"hba1c": undefined, "height": "1.4986", "last_fasting_bg": undefined, "weight": 90.8}, 
            "M", 
            todayForEligibility,
            true
        );
        expect(db.updateEligibilityAppEmail).toHaveBeenCalledTimes(1);
    });
})