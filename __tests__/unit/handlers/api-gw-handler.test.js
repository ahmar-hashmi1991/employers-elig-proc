const db = require('../../../src/services/rds-data-service');
const braze = require('../../../src/services/braze-service');
const sf = require('../../../src/services/salesforce-service');
const shop = require('../../../src/services/shop-service');
const dario = require('../../../src/services/dario-service');
const engage = require('../../../src/services/engage-service');
const secrets = require('../../../src/services/secrets-service');
const states = require('../../../src/services/step-function-service');
const emailSrv = require('../../../src/services/email-service');
const utils = require('../../../src/common/utils')
const queue = require('../../../src/services/sqs-service');
const constants = require('../../../src/common/constants');

const elig_rule = { productTypes: ["BG", "BP"], validationFields: ["reseller_employee_id", "role", "dob"] }
const EMPLOYER = { id: 23, reseller_id: 1, external_id: '12345', eligibility_rules: JSON.stringify(elig_rule) };
const RESELLER = { id: 1, eid: 'Ikkqa3', name: 'vitality', eligibility_rules: JSON.stringify({ "productTypes": ["BG", "BP"], "validationFields": ["reseller_employee_id", "role", "dob"] }) }

const ELIGIBILITY = { "id": 246, "eid": "68c7d7da-5f6e-4abb-8e41-20a2edd6f7aa", "employer_id": 1, "first_name": "margo", "last_name": "test", "email": "rabotasleep+elig18@gmail.com", "phone": "741258456", "shop_phone": null, "gender": "M", "dob": "1987-07-20T00:00:00.000Z", "status": "eligible", "stage": "new", "employee_id": "123682", "reseller_employee_id": "VS00123683", "role": "DP", "group_name": "ABC COMPANY", "branch": "TEST", "sf_id": "0011q00000bhEATAA2", "braze_id": null, "dario_app_uid": null, "app_email": null, "created_at": "2020-09-23T12:21:57.000Z", "updated_at": "2020-09-23T12:21:57.000Z", "attribute_1": null, "attribute_2": null, "attribute_3": null, "attribute_4": null, "attribute_5": null }

describe('Test for api-gw-handler', () => {

    beforeAll(() => {
        // jest.mock('../../../src/services/rds-data-service');
        jest.mock('../../../src/handlers/api-gw-firewall-handler', () => {
            return{
                callHandleProvisioning: jest.fn().mockResolvedValue({ status: 'success' })
            }
        });
        db.beginTransaction = jest.fn();
        db.commit = jest.fn();
        db.rollback = jest.fn();
        db.end = jest.fn();
        db.updateEligibilityStatus = jest.fn().mockResolvedValue([{}]);
        db.addEligibilityLog = jest.fn().mockResolvedValue({ insertId: 1 });
        db.getEligibility = jest.fn().mockResolvedValue([[ELIGIBILITY], []]);
        db.updateEligibility = jest.fn().mockResolvedValue([{ affectedRows: 1, changedRows: 1 }]);
        db.addRedeemedProductToList = jest.fn().mockResolvedValue({ insertId: 1 });
        db.getEmployerByID = jest.fn().mockResolvedValue([[], []]);
        db.getEligibilityByFields = jest.fn().mockResolvedValue([[ELIGIBILITY], []]);
        db.getRedeemedProductsList = jest.fn().mockResolvedValue([[], []]);
        db.getEmployer = jest.fn().mockResolvedValue([[EMPLOYER], []]);
        db.getReseller = jest.fn().mockResolvedValue([[RESELLER], []]);
        db.getResellerByExternalID = jest.fn().mockResolvedValue([[], []]);
        db.getResellerByName = jest.fn().mockResolvedValue([[], []]);
        db.getEmployersByResellerId = jest.fn().mockResolvedValue([[], []]);
        db.getActiveEmployersByResellerId = jest.fn().mockResolvedValue([[], []]);
        db.getEmployerAttribute = jest.fn().mockResolvedValue([[], []]);
        db.updateEligibilityStatusStage = jest.fn().mockResolvedValue([[], []]);
        db.updateEligibilityStage = jest.fn().mockResolvedValue([[], []]);
        db.updateEligibilityAppEmail = jest.fn().mockResolvedValue([{ affectedRows: 1, changedRows: 1 }]);
        db.addEligibilityFlowLogTrx = jest.fn().mockResolvedValue([{insertId: 21}]);
        db.reportToFileLog = jest.fn().mockResolvedValue([{insertId: 21}]);
        db.createFileHistoryLog = jest.fn().mockResolvedValue([{insertId: 12}]);
        db.addEligibilityTrx = jest.fn().mockResolvedValue([[{insertId: 999}],[]]);
        db.addEligibilityLog  = jest.fn().mockResolvedValue([{}]);
        db.updateEligibilitySalesForceIDTrx = jest.fn().mockResolvedValue([{}]);
        db.addEligibilityCheckFailedLog = jest.fn().mockResolvedValue([{insertId: 4557,}]);
        db.updateEligibilityStatusTrx = jest.fn()
        db.addEligibilityLog = jest.fn()
        db.updateRedeemedProductsStatus = jest.fn().mockResolvedValue('mock response')


        //braze
        braze.sendUserEvent = jest.fn().mockResolvedValue({ status: 'success' });
        braze.updateAttributes = jest.fn().mockResolvedValue({ status: 'success' });
        braze.subscribeToAllSubscriptionGroups = jest.fn().mockResolvedValue({ status: 'success' });
        //email
        emailSrv.sendEmailWithAttachment = jest.fn().mockResolvedValue({ messageId: 'b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com', success: true, errors: [] });
        emailSrv.sendEmail = jest.fn().mockResolvedValue({ messageId: 'b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com', success: true, errors: [] });
        emailSrv.sendTemplateEmail = jest.fn().mockResolvedValue({ messageId: 'b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com', success: true, errors: [] });
        //Salesforce
        sf.createOrUpdateEligibility = jest.fn().mockResolvedValue({ id: '0011q00000b2kwIAAQ', success: true, errors: [] });
        sf.updateEligibilityStatus = jest.fn().mockResolvedValue({ id: '0011q00000b2kwIAAQ', success: true, errors: [] });
        sf.cancelOrders = jest.fn().mockResolvedValue({ id: '0011q00000b2kwIAAQ', success: true, errors: [] });
        sf.updateAccountEligibility = jest.fn().mockResolvedValue({ id: '0011q00000b2kwIAAQ', success: true, errors: [] });
        sf.updateEligibilityStage = jest.fn().mockResolvedValue({ id: '0011q00000b2kwIAAQ', success: true, errors: [] });
        //StepFunctions
        states.executeAssignUserToClinic = jest.fn().mockResolvedValue({ status: 'SUCCESS' });
        states.executeAssignUserToClinicV2 = jest.fn().mockResolvedValue({ status: 'SUCCESS' });
        //sns
        queue.sendMessage = jest.fn().mockResolvedValue({ status: 'success' });
        //shop
        shop.cancelOrders = jest.fn().mockResolvedValue({ status: 'success' });
        dario.createDarioUser = jest.fn().mockResolvedValue({ status: 'success' });
        dario.assignToClinic = jest.fn().mockResolvedValue({
            "status": 201,
            "error": {
                "code": 0,
                "description": "ok"
            },
            "data": {
                "id": "xULrmU",
                "email": "edan@mydario.com.com",
                "glucometers": [],
                "meta_data": [],
                "status": "requested",
                "created": 1628068976,
                "modified": 1628068976
            }
        });
        dario.DarioUserMembership = jest.fn().mockResolvedValue({
            "status": 200,
            "error": {
                "code": 0,
                "description": "ok"
            },
            "data": {
                "123nitzan2@yahoo.com": {
                    "membership": {
                        "membership_plan": "MEMBER_B2B",
                        "expiration": null,
                        "overrides": {
                            "block_bg_last_3_months": null,
                            "block_bp_last_3_months": null,
                            "chat_feature": null,
                            "checkup_call_feature": null,
                            "main_screen_upgrade_hook": null,
                            "membership_screen_feature": null,
                            "membership_upgrade_hook": null,
                            "strips_counter_feature": null,
                            "weekly_content_feature": null,
                            "whats_new_upgrade_hook": null,
                            "chat_locked_link": null,
                            "display_name": null,
                            "main_screen_upgrade_link": null,
                            "membership_upgrade_link": null,
                            "whats_new_upgrade_link": null,
                            "checkup_call_expert": null,
                            "vital_snap_feature": null,
                            "membership_in_a_box_hook": null,
                            "membership_in_a_box_link": null,
                            "membership_in_a_box_link_title": null,
                            "membership_upgrade_link_display": null,
                            "contact_us_email": null,
                            "contact_us_phone": null,
                            "hide_reminder_personal_section": null,
                            "hide_shop_menu": null,
                            "isB2B": 1,
                            "channel": null,
                            "WM": null,
                            "features": null,
                            "hide_weight_upsell": null,
                            "BG": 1,
                            "BH": null,
                            "BP": null,
                            "EAP": null,
                            "disable_mini_programs": null,
                            "freemium_open_for": null,
                            "hide_logbook_BG": null,
                            "hide_mini_programs": null,
                            "hide_plus_BG": 0,
                            "clinic": null,
                            "clinic_meta": null,
                            "vbm_plan": null,
                            "MSK": null,
                            "mebership_in_a_box_feature": null,
                            "mebership_in_a_box_hook": null
                        },
                        "status": 200
                    }
                }
            }
        });

        secrets.getSecret = jest.fn().mockResolvedValue({ apikey: 'fdasfdsfadsfasdfdas' });
        jest.mock('../../../src/handlers/api-gw-firewall-handler', () => {
            return{
                callHandleProvisioning: jest.fn().mockResolvedValue({ status: 'success' })
            }
        });
        engage.assignPatientToCoach = jest.fn().mockResolvedValue({ status: 'success' });
        //omit logging
        console.log = jest.fn();
    })

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('Verifies <updateEligibilityRecord> - with orders', async () => {
        const elig_rules = JSON.stringify({
            "productTypes": ["BG","BP","MSK"],
            "validationFields": ["reseller_employee_id", "role", "dob"],
            "provisioning": { "dario": true, "assignToClinic": { "products": ['BP', 'BG', 'WM', 'MSK', 'BH'], "clinic_auth": "teststring=" } }
        });
        let employer = { id: 23, external_id: '99999', mapping_rules: {}, eligibility_rules: elig_rules };
        let eligibility = {...ELIGIBILITY, email: 'vptestdario3@vptest.com', shop_email: 'vptestdario3@vptest.com'};

        let data = {
            phone: '+17077324532',
            email: 'vptestdario3@vptest.com',
            orders: [
              { product_type: 'BP', date: '2021-12-15 06:45', order_id: 75012377, subscription_id: 75012378 },
              { product_type: 'BG', date: '2021-12-15 06:45', order_id: 75012379, subscription_id: 75012380 },
              { product_type: 'WM', date: '2021-12-15 06:45', order_id: 75012381, subscription_id: 75012382 },
              { product_type: 'MSK', date: '2021-12-15 06:45', order_id: 75012383, subscription_id: 75012384 },
              { product_type: 'BH', date: '2021-12-15 06:45', order_id: 75012385, subscription_id: 75012386 }
            ]
          }

        const apiHandler = require('../../../src/handlers/api-gw-handler');
        await apiHandler.updateEligibilityRecord(data, eligibility, employer);
        expect(db.addEligibilityLog).toHaveBeenCalledTimes(1);
        expect(sf.createOrUpdateEligibility).toHaveBeenCalledTimes(1);
        expect(braze.sendUserEvent).toHaveBeenCalledTimes(1);
        expect(braze.sendUserEvent).toHaveBeenCalledWith(
            'vptestdario3@vptest.com',
            'employer_eligibility_update',
            {},
            expect.objectContaining({
                b2b_product_type_list: {add: ['BP', 'BG', 'WM', 'MSK', 'BH']}
            }),
            employer.id
        )
    });

    it('Verifies <updateEligibilityRecord> - with orders and eligibility with no phone', async () => {
        const elig_rules = JSON.stringify({
            "productTypes": ["BG","BP","MSK"],
            "validationFields": ["reseller_employee_id", "role", "dob"],
            "provisioning": { "dario": true, "assignToClinic": { "products": ['BP', 'BG', 'WM', 'MSK', 'BH'], "clinic_auth": "teststring=" } }
        });
        let employer = { id: 23, external_id: '99999', mapping_rules: {}, eligibility_rules: elig_rules };
        let eligibility = {...ELIGIBILITY, email: 'eligibilityemail@comp.com', phone: null, shop_email: null};

        let data = {
            phone: '+17077324532',
            email: 'shopemail@comp.com',
            orders: [
              { product_type: 'BP', date: '2021-12-15 06:45', order_id: 75012377, subscription_id: 75012378 },
              { product_type: 'BG', date: '2021-12-15 06:45', order_id: 75012379, subscription_id: 75012380 },
              { product_type: 'WM', date: '2021-12-15 06:45', order_id: 75012381, subscription_id: 75012382 },
              { product_type: 'MSK', date: '2021-12-15 06:45', order_id: 75012383, subscription_id: 75012384 },
              { product_type: 'BH', date: '2021-12-15 06:45', order_id: 75012385, subscription_id: 75012386 }
            ]
          }

        const apiHandler = require('../../../src/handlers/api-gw-handler');
        await apiHandler.updateEligibilityRecord(data, eligibility, employer);
        expect(db.addEligibilityLog).toHaveBeenCalledTimes(1);
        expect(sf.createOrUpdateEligibility).toHaveBeenCalledTimes(1);
        expect(braze.sendUserEvent).toHaveBeenCalledTimes(2);
        expect(braze.sendUserEvent).toHaveBeenNthCalledWith(1,
            'shopemail@comp.com',
            'employer_eligibility_update',
            {},
            expect.objectContaining({
                phone: '+17077324532'
            })
        );
        expect(braze.sendUserEvent).toHaveBeenNthCalledWith(2,
            'eligibilityemail@comp.com',
            'employer_eligibility_update',
            {},
            expect.objectContaining({
                phone: '+17077324532',
                b2b_product_type_list: {add: ['BP', 'BG', 'WM', 'MSK', 'BH']}
            }), employer.id
        );
    });

    it('Verifies <updateEligibilityRecord> - with NO orders', async () => {
        const elig_rules = JSON.stringify({
            "productTypes": ["BG","BP","MSK"],
            "validationFields": ["reseller_employee_id", "role", "dob"],
            "provisioning": { "dario": true, "assignToClinic": { "products": ['BP', 'BG', 'WM', 'MSK', 'BH'], "clinic_auth": "teststring=" } }
        });
        let employer = { id: 23, external_id: '99999', mapping_rules: {}, eligibility_rules: elig_rules };
        let eligibility = {...ELIGIBILITY, email: 'vptestdario3@vptest.com', shop_email: 'vptestdario3@vptest.com'};

        let data = {
            phone: '+17077324532',
            email: 'vptestdario3@vptest.com'
          }

        const apiHandler = require('../../../src/handlers/api-gw-handler');
        await apiHandler.updateEligibilityRecord(data, eligibility, employer);
        expect(db.addEligibilityLog).toHaveBeenCalledTimes(1);
        expect(sf.createOrUpdateEligibility).toHaveBeenCalledTimes(1);
        expect(braze.sendUserEvent).toHaveBeenCalledTimes(1);
        expect(braze.sendUserEvent).toHaveBeenCalledWith(
            'vptestdario3@vptest.com',
            'employer_eligibility_update',
            {},
            expect.not.objectContaining({
                b2b_product_type_list: {add: ['BP', 'BG', 'WM', 'MSK', 'BH']}
            }), employer.id
        )
    });

    it('Verifies <updateEligibilityStatusToEnrolled> - no provisioning to Dario Clinic', async () => {
        const elig_rules = JSON.stringify({
            "productTypes": ["BG","BP","MSK"],
            "validationFields": ["reseller_employee_id", "role", "dob"],
            "provisioning": { "dario": true, "assignToClinic": { "products": ["MSK"], "clinic_auth": "teststring=" } }
        });
        let mapping = { "FirstName": "first_name", "LastName": "last_name", "Email Address": "email", "Phone Number": "phone", "Employee ID": "employee_id", "Vitality ID": "reseller_employee_id", "Role": "role", "Gender": "gender", "Date of Birth": { "key": "dob", "transform": "date:'MM/DD/YYYY'" }, "Branch": "branch", "Group Name": "group_name" };
        let employer = { id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules };
        let eligibility = {
            "id": 1103,"eid": "725375e6-22c1-4817-95f9-3c02b093694b","employer_id": 23,"first_name": "nastya","last_name": "Cfh49",
            "email": "rabotasleep+cfhc10@gmail.com","shop_email": "rabotasleep+cfhc10@gmail.com","phone": '2283837556',"home_phone": "2282059999","shop_phone": null,"gender": "F","dob": "1982-09-07T00:00:00.000Z",
            "address_1": "3200 Dumas Rd","address_2": " ","city": "Moss Point","state": "MS ","zipcode": "39562",
            "status": "eligible","stage": "new","employee_id": "","reseller_employee_id": "A42526624","role": "EE","group_name": "Coastal Family","branch": null,
            "pcp_id": null,"sku": null,"targeting": 0,
            "sf_id": "0011q00000sS3YSAA0","braze_id": null,"dario_app_uid": null,"app_email": null,"generated_email": 0,"flow_id": 1250,
            "created_at": "2021-08-04T07:28:55.000Z","updated_at": "2021-08-04T07:28:59.000Z",
            "eligible_products": {
                "BP": true,
                "BG": true,
                "MSK": true
            },
            "support_email": "chroniccare@coastalfamilyhealth.org",
            "support_phone": "228.374.4991 ext. 1254"
          }

        let shopdata = {
            orders: [
                {
                    product_type: 'BG',
                    date: '2020-09-23 12:29',
                    order_id: 75023793,
                    subscription_id: 75023795
                }
            ]
        };

        const apiHandler = require('../../../src/handlers/api-gw-handler');
        await apiHandler.updateEligibilityStatusToEnrolled(eligibility, employer, shopdata);
        expect(dario.assignToClinic).toHaveBeenCalledTimes(0);
    });

    it('Verifies <updateEligibilityStatusToEnrolled> - Created Provisioning to Dario Clinic', async () => {
        const elig_rules = JSON.stringify({
            "productTypes": ["BG","BP","MSK"],
            "validationFields": ["reseller_employee_id", "role", "dob"],
            "provisioning": { "dario": true, "assignToClinic": { "products": ["MSK"], "clinic_auth": "teststring=" } }
        });
        const mapping = { "FirstName": "first_name", "LastName": "last_name", "Email Address": "email", "Phone Number": "phone", "Employee ID": "employee_id", "Vitality ID": "reseller_employee_id", "Role": "role", "Gender": "gender", "Date of Birth": { "key": "dob", "transform": "date:'MM/DD/YYYY'" }, "Branch": "branch", "Group Name": "group_name" };
        let employer = { id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules };
        let eligibility = {
            "id": 1103,"eid": "725375e6-22c1-4817-95f9-3c02b093694b","employer_id": 23,"first_name": "nastya","last_name": "Cfh49",
            "email": "rabotasleep+cfhc10@gmail.com","shop_email": "rabotasleep+cfhc10@gmail.com","phone": '2283837556',"home_phone": "2282059999","shop_phone": null,"gender": "F","dob": "1982-09-07T00:00:00.000Z",
            "address_1": "3200 Dumas Rd","address_2": " ","city": "Moss Point","state": "MS ","zipcode": "39562",
            "status": "eligible","stage": "new","employee_id": "","reseller_employee_id": "A42526624","role": "EE","group_name": "Coastal Family","branch": null,
            "pcp_id": null,"sku": null,"targeting": 0,
            "sf_id": "0011q00000sS3YSAA0","braze_id": null,"dario_app_uid": null,"app_email": null,"generated_email": 0,"flow_id": 1250,
            "created_at": "2021-08-04T07:28:55.000Z","updated_at": "2021-08-04T07:28:59.000Z",
            "eligible_products": {
                "BP": true,
                "BG": true,
                "MSK": true
            },
            "support_email": "chroniccare@coastalfamilyhealth.org",
            "support_phone": "228.374.4991 ext. 1254"
          }

        let shopdata = {
            orders: [
                {
                    product_type: 'MSK',
                    date: '2020-09-23 12:29',
                    order_id: 75023793,
                    subscription_id: 75023795
                }
            ]
        };

        const apiHandler = require('../../../src/handlers/api-gw-handler');
        await apiHandler.updateEligibilityStatusToEnrolled(eligibility, employer, shopdata);
        expect(states.executeAssignUserToClinicV2).toHaveBeenCalledTimes(1);
    });

    it('Verifies <updateEligibilityStatusToEnrolled> - No Provisioning Created to Dario Clinic', async () => {
        const elig_rules = JSON.stringify({
            "productTypes": ["BP"],
            "validationFields": ["reseller_employee_id", "role", "dob"]
        });
        const mapping = { "FirstName": "first_name", "LastName": "last_name", "Email Address": "email", "Phone Number": "phone", "Employee ID": "employee_id", "Vitality ID": "reseller_employee_id", "Role": "role", "Gender": "gender", "Date of Birth": { "key": "dob", "transform": "date:'MM/DD/YYYY'" }, "Branch": "branch", "Group Name": "group_name" };
        let employer = { id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules };
        let eligibility = {
            "id": 1103,"eid": "725375e6-22c1-4817-95f9-3c02b093694b","employer_id": 23,"first_name": "nastya","last_name": "Cfh49",
            "email": "rabotasleep+cfhc10@gmail.com","shop_email": "rabotasleep+cfhc10@gmail.com","phone": null,"home_phone": "2282059999","shop_phone": null,"gender": "F","dob": "1982-09-07T00:00:00.000Z",
            "address_1": "3200 Dumas Rd","address_2": " ","city": "Moss Point","state": "MS ","zipcode": "39562",
            "status": "eligible","stage": "new","employee_id": "","reseller_employee_id": "A42526624","role": "EE","group_name": "Coastal Family","branch": null,
            "pcp_id": null,"sku": null,"targeting": 0,
            "sf_id": "0011q00000sS3YSAA0","braze_id": null,"dario_app_uid": null,"app_email": null,"generated_email": 0,"flow_id": 1250,
            "created_at": "2021-08-04T07:28:55.000Z","updated_at": "2021-08-04T07:28:59.000Z",
            "eligible_products": {
                "BP": true
            },
            "support_email": "chroniccare@coastalfamilyhealth.org",
            "support_phone": "228.374.4991 ext. 1254"
          }

        let shopdata = {
            orders: [
                {
                    product_type: 'BP',
                    date: '2020-09-23 12:29',
                    order_id: 75023793,
                    subscription_id: 75023795
                }
            ]
        };

        const apiHandler = require('../../../src/handlers/api-gw-handler');
        await apiHandler.updateEligibilityStatusToEnrolled(eligibility, employer, shopdata);
        expect(dario.assignToClinic).toHaveBeenCalledTimes(0);
    });

    it('Verifies <DisableDarioUserMembership> - Disable Dario User Membership', async () => {
        const elig_rules = {
            "productTypes": ["BP"],
            "validationFields": ["reseller_employee_id", "role", "dob"],
            "membershipDisabled": {
                "membership_plan": "",
                "clinic": "",
                "clinic_meta": { "channel": "", "sub_channel": "" },
                "display_name": "",
                "checkup_call_expert": "",
                "contact_us_email": "",
                "contact_us_phone": "",
                "activate_grocery_scanner": false,
                "activate_healthkit_observers": false
            }
        };
        const mapping = { "FirstName": "first_name", "LastName": "last_name", "Email Address": "email", "Phone Number": "phone", "Employee ID": "employee_id", "Vitality ID": "reseller_employee_id", "Role": "role", "Gender": "gender", "Date of Birth": { "key": "dob", "transform": "date:'MM/DD/YYYY'" }, "Branch": "branch", "Group Name": "group_name" };
        let employer = { employer_id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: JSON.stringify(elig_rules) };

        let eligibility = {
            "id": 1103,"eid": "725375e6-22c1-4817-95f9-3c02b093694b","employer_id": 23,"first_name": "nastya","last_name": "Cfh49",
            "email": "rabotasleep+cfhc10@gmail.com","shop_email": "rabotasleep+cfhc10@gmail.com","phone": null,"home_phone": "2282059999","shop_phone": null,"gender": "F","dob": "1982-09-07T00:00:00.000Z",
            "address_1": "3200 Dumas Rd","address_2": " ","city": "Moss Point","state": "MS ","zipcode": "39562",
            "status": "eligible","stage": "new","employee_id": "","reseller_employee_id": "A42526624","role": "EE","group_name": "Coastal Family","branch": null,
            "pcp_id": null,"sku": null,"targeting": 0,
            "sf_id": "0011q00000sS3YSAA0","braze_id": null,"dario_app_uid": null,"app_email": "null","generated_email": 0,"flow_id": 1250,
            "created_at": "2021-08-04T07:28:55.000Z","updated_at": "2021-08-04T07:28:59.000Z",
            "eligible_products": {
                "BP": true
            },
            "support_email": "chroniccare@coastalfamilyhealth.org",
            "support_phone": "228.374.4991 ext. 1254"
          }

        let shopdata = {
            orders: [
                {
                    product_type: 'BP',
                    date: '2020-09-23 12:29',
                    order_id: 75023793,
                    subscription_id: 75023795
                }
            ]
        };

        db.getEmployerByID = jest.fn().mockResolvedValue([[employer]]);

        const apiHandler = require('../../../src/handlers/dario-user-handler');
        await apiHandler.DisableDarioUserMembership(eligibility);
        expect(dario.DarioUserMembership).toHaveBeenCalledTimes(1);
    });

    it('Verifies <DisableDarioUserMembership> -  Disable Dario User Membership Rules Without Membership Disabled', async () => {
        const elig_rules = {
            "productTypes": ["BP"],
            "validationFields": ["reseller_employee_id", "role", "dob"]
        };
        const mapping = { "FirstName": "first_name", "LastName": "last_name", "Email Address": "email", "Phone Number": "phone", "Employee ID": "employee_id", "Vitality ID": "reseller_employee_id", "Role": "role", "Gender": "gender", "Date of Birth": { "key": "dob", "transform": "date:'MM/DD/YYYY'" }, "Branch": "branch", "Group Name": "group_name" };
        let employer = { employer_id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: JSON.stringify(elig_rules) };

        let eligibility = {
            "id": 1103,"eid": "725375e6-22c1-4817-95f9-3c02b093694b","employer_id": 23,"first_name": "nastya","last_name": "Cfh49",
            "email": "rabotasleep+cfhc10@gmail.com","shop_email": "rabotasleep+cfhc10@gmail.com","phone": null,"home_phone": "2282059999","shop_phone": null,"gender": "F","dob": "1982-09-07T00:00:00.000Z",
            "address_1": "3200 Dumas Rd","address_2": " ","city": "Moss Point","state": "MS ","zipcode": "39562",
            "status": "eligible","stage": "new","employee_id": "","reseller_employee_id": "A42526624","role": "EE","group_name": "Coastal Family","branch": null,
            "pcp_id": null,"sku": null,"targeting": 0,
            "sf_id": "0011q00000sS3YSAA0","braze_id": null,"dario_app_uid": null,"app_email": "null","generated_email": 0,"flow_id": 1250,
            "created_at": "2021-08-04T07:28:55.000Z","updated_at": "2021-08-04T07:28:59.000Z",
            "eligible_products": {
                "BP": true
            },
            "support_email": "chroniccare@coastalfamilyhealth.org",
            "support_phone": "228.374.4991 ext. 1254"
          }

        let shopdata = {
            orders: [
                {
                    product_type: 'BP',
                    date: '2020-09-23 12:29',
                    order_id: 75023793,
                    subscription_id: 75023795
                }
            ]
        };

        db.getEmployerByID = jest.fn().mockResolvedValue([[employer]]);

        const apiHandler = require('../../../src/handlers/dario-user-handler');
        await apiHandler.DisableDarioUserMembership(eligibility);
        expect(dario.DarioUserMembership).toHaveBeenCalledTimes(0);
    });



    it('Verifies <updateEligibility> - eligibility object update from input', async () => {
        let current = {
            id: 731, eid: '767b29ec-f0bb-4617-9f9e-acec376a42d9',
            employer_id: 3, first_name: 'Elaine', last_name: 'Benes', email: 'emerson+12@mydario.com', shop_email: null,
            phone: '4444444444', shop_phone: null, gender: 'F', dob: '1996-08-04T00:00:00.000Z', status: 'eligible', stage: 'new',
            employee_id: '100012', reseller_employee_id: 'VS10000012', role: 'EE', group_name: 'Emerson', branch: 'TEST',
            targeting: 0, sf_id: '0011q00000fie3GAAQ', braze_id: null, dario_app_uid: null, app_email: null, flow_id: 1250,
            created_at: '2020-12-22T06:36:05.000Z', updated_at: '2020-12-22T06:36:06.000Z',
            attribute_1: null, attribute_2: null, attribute_3: null, attribute_4: null, attribute_5: null
        }
        let shopData = { targeting: 1 };
        const apiHandler = require('../../../src/handlers/api-gw-handler');

        let newrec = apiHandler.generateUpdateRecord(current, shopData);
        expect(newrec).toEqual(
            expect.objectContaining({
                targeting: 1
            })
        );
    });

    it('Verifies <generateFilterField> - generates query correctly', async () => {
        let form_data = {
            name: 'Roni',
            names: ['John', 'Mary'],
            first_name: 'Jerry',
            last_name: 'Seinfeld',
            email: ['jerry@corp.com']
        };
        let employers = [{ id: '123' }];
        const apiHandler = require('../../../src/handlers/api-gw-handler');

        let [filter, fieldVal] = apiHandler.generateFilterField(form_data, 'name');

        expect(filter).toEqual('name = LCASE(?)');
        expect(fieldVal).toEqual('roni');

        [filter, fieldVal] = apiHandler.generateFilterField(form_data, 'name|2');

        expect(filter).toEqual('name like LCASE(?)');
        expect(fieldVal).toEqual('ro%');

        [filter, fieldVal] = apiHandler.generateFilterField(form_data, 'names');

        expect(filter).toEqual('names in (?)');
        expect(fieldVal).toEqual(['John', 'Mary']);

        await apiHandler.getEligibilityFromData(employers, form_data, { validationFields: ['first_name', 'last_name|2', 'email'] });
        expect(db.getEligibilityByFields).toHaveBeenCalled();
        expect(db.getEligibilityByFields).toBeCalledWith(
            'first_name = LCASE(?) AND last_name like LCASE(?) AND email in (?) AND employer_id = ?',
            ['jerry', 'se%', ['jerry@corp.com'], '123']
        );
    });

    it('Verifies <generateFilterField> - generates query correctly with OR condition', async () => {
        let form_data = {
            name: 'Roni',
            names: ['John', 'Mary'],
            first_name: 'Jerry',
            last_name: 'Seinfeld',
            email: ['jerry@corp.com']
        };
        let employers = [{ id: '123' }];
        const apiHandler = require('../../../src/handlers/api-gw-handler');

        await apiHandler.getEligibilityFromData(employers, form_data, { validationFields: [['first_name', 'last_name|2'], 'email'] });
        expect(db.getEligibilityByFields).toHaveBeenCalled();
        expect(db.getEligibilityByFields).toBeCalledWith(
            '(first_name = LCASE(?) OR last_name like LCASE(?)) AND email in (?) AND employer_id = ?',
            ['jerry', 'se%', ['jerry@corp.com'], '123']
        );
    });

    it('Verifies <generateFilterField> - generates query correctly with REGEXP condition', async () => {
        let form_data = {
            name: 'Roni',
            names: ['John', 'Mary'],
            first_name: 'Jerry',
            last_name: 'Seinfeld',
            email: 'jerry@corp.com'
        };
        let employers = [{ id: '123' }];
        const apiHandler = require('../../../src/handlers/api-gw-handler');

        await apiHandler.getEligibilityFromData(employers, form_data, { validationFields: ['first_name@', 'last_name', 'email'] });
        expect(db.getEligibilityByFields).toHaveBeenCalled();
        expect(db.getEligibilityByFields).toBeCalledWith(
            'first_name REGEXP ? AND last_name = LCASE(?) AND email = LCASE(?) AND employer_id = ?',
            ['^[[:space:]]*jerry[[:space:]]*$', 'seinfeld', 'jerry@corp.com', '123']
        );
    });

    it('Verifies <generateFilterField> - generates query correctly with numeric comparison', async () => {
        let form_data = {
            name: 'Roni',
            names: ['John', 'Mary'],
            first_name: 'Jerry',
            last_name: 'Seinfeld',
            email: 'jerry@corp.com',
            employee_id: '01234567'
        };
        let employers = [{ id: '123' }];
        const apiHandler = require('../../../src/handlers/api-gw-handler');

        await apiHandler.getEligibilityFromData(employers, form_data, { validationFields: ['first_name', 'last_name', 'email', 'employee_id+'] });
        expect(db.getEligibilityByFields).toHaveBeenCalled();
        expect(db.getEligibilityByFields).toBeCalledWith(
            'first_name = LCASE(?) AND last_name = LCASE(?) AND email = LCASE(?) AND employee_id = ? AND employer_id = ?',
            ['jerry', 'seinfeld', 'jerry@corp.com', 1234567, '123']
        );
    });

    it('Verifies <generateFilterField> - generates query correctly with OR condition #2', async () => {
        let form_data = {
            first_name: 'Matan',
            middle_name: '',
            last_name: 'Cfh1',
            dob: '1992-07-22',
            address_1: '1234 Market Street',
            address_2: '',
            city: 'Manhattan',
            state: 'NY',
            postcode: '10036',
            email: 'el_16269378603430429_B2027674687_cfh_t@mydario.com',
            email_verification: 'el_16269378603430429_B2027674687_cfh_t@mydario.com',
            gender: 'M',
            no_phone: '1',
            eligibility_country: 'US',
            emp: 'coastal',
            tid: '',
            sec: '2c657b720dbdaeabeb099371d701d2a6',
            terms: 'on',
            'terms-field': '1',
            role: [null]
        };
        let employers = [{ id: '123' }];
        const apiHandler = require('../../../src/handlers/api-gw-handler');

        await apiHandler.getEligibilityFromData(employers, form_data, {
            validationFields: ["first_name", "last_name", "dob", "gender",
                ["phone", "email"]]
        });
        expect(db.getEligibilityByFields).toHaveBeenCalled();
        expect(db.getEligibilityByFields).toBeCalledWith(
            'first_name = LCASE(?) AND last_name = LCASE(?) AND dob = LCASE(?) AND gender = LCASE(?) AND (email = LCASE(?)) AND employer_id = ?',
            ['matan', 'cfh1', '1992-07-22', 'm', 'el_16269378603430429_b2027674687_cfh_t@mydario.com', '123']
        );
    });


    it('Verifies <generateFilterField> - generates query correctly with OR condition #3', async () => {
        let form_data = {
            employer_id: "20024",
            first_name: "Nastya_Aven02",
            last_name: "Avenel01",
            email: "clifford_bauch8@test.soleranetwork.com",
            gender: "F",
            dob: "2000-01-01",
            address_1: "111 w monroe St",
            city: "Phoenix",
            state: "AZ",
            zipcode: "",
            reseller_employee_id: ""
        };
        let employers = [{ id: '123' }];
        const apiHandler = require('../../../src/handlers/api-gw-handler');

        await apiHandler.getEligibilityFromData(employers, form_data, {
            validationFields: [
                ["reseller_employee_id"],
                ["first_name", "last_name", "dob", "gender"]
              ]
        });
        expect(db.getEligibilityByFields).toHaveBeenCalled();
        expect(db.getEligibilityByFields).toBeCalledWith(
            '(first_name = LCASE(?) AND last_name = LCASE(?) AND dob = LCASE(?) AND gender = LCASE(?)) AND employer_id = ?',
            ["nastya_aven02", "avenel01", "2000-01-01", "f", "123"]
        );
    });

    it('Verifies <generateFilterField> - generates query correctly with OR condition #4', async () => {
        let form_data = {
            employer_id: "20024",
            first_name: "Nastya_Aven02",
            last_name: "Avenel01",
            email: "clifford_bauch8@test.soleranetwork.com",
            gender: "F",
            dob: "2000-01-01",
            address_1: "111 w monroe St",
            city: "Phoenix",
            state: "AZ",
            zipcode: "",
            reseller_employee_id: "77777"
        };
        let employers = [{ id: '123' }];
        const apiHandler = require('../../../src/handlers/api-gw-handler');

        await apiHandler.getEligibilityFromData(employers, form_data, {
            validationFields: [
                ["reseller_employee_id"],
                ["first_name", "last_name", "dob", "gender"]
              ]
        });
        expect(db.getEligibilityByFields).toHaveBeenCalled();
        expect(db.getEligibilityByFields).toBeCalledWith(
            '(reseller_employee_id = LCASE(?)) OR (first_name = LCASE(?) AND last_name = LCASE(?) AND dob = LCASE(?) AND gender = LCASE(?)) AND employer_id = ?',
            [ "77777", "nastya_aven02", "avenel01", "2000-01-01", "f", "123" ]
        );
    });

    it('Verifies <generateFilterField> - generates query correctly with OR condition #5', async () => {
        let form_data = {
            first_name: 'gili',
            last_name: 'sultz',
            gender: 'F',
            selectedMonth: 7,
            selectedDay: 17,
            selectedYear: 1997,
            terms: true,
            phone: '+972502223405',
            dob: '1997-07-17',
            country: 'US'
          };
        let employers = [{ id: '123' }];
        const apiHandler = require('../../../src/handlers/api-gw-handler');

        await apiHandler.getEligibilityFromData(employers, form_data, {
            validationFields: [
                [
                    "first_name",
                    "last_name",
                    "dob",
                    "gender"
                ]
            ]
        });
        expect(db.getEligibilityByFields).toHaveBeenCalled();
        expect(db.getEligibilityByFields).toBeCalledWith(
            'first_name = LCASE(?) AND last_name = LCASE(?) AND dob = LCASE(?) AND gender = LCASE(?) AND employer_id = ?',
            ["gili", "sultz", "1997-07-17", "f", "123"]
        );
    });

    it('Verifies <updateEligibilityStatusToEnrolled> - provisioning to Dario Clinic - INVALID phone number', async () => {
        const elig_rules = JSON.stringify({
            "productTypes": ["BG","BP","MSK"],
            "validationFields": ["reseller_employee_id", "role", "dob"],
            "provisioning": { "dario": true, "assignToClinic": { "products": ["MSK"], "clinic_auth": "teststring=" } }
        });
        const mapping = { "FirstName": "first_name", "LastName": "last_name", "Email Address": "email", "Phone Number": "phone", "Employee ID": "employee_id", "Vitality ID": "reseller_employee_id", "Role": "role", "Gender": "gender", "Date of Birth": { "key": "dob", "transform": "date:'MM/DD/YYYY'" }, "Branch": "branch", "Group Name": "group_name" };
        let employer = { id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules };
        let eligibility = {
            "id": 1103,"eid": "725375e6-22c1-4817-95f9-3c02b093694b","employer_id": 23,"first_name": "nastya","last_name": "Cfh49",
            "email": "rabotasleep+cfhc10@gmail.com","shop_email": "rabotasleep+cfhc10@gmail.com","phone": "4444444444","home_phone": null,"shop_phone": null,"gender": "F","dob": "1982-09-07T00:00:00.000Z",
            "address_1": "3200 Dumas Rd","address_2": " ","city": "Moss Point","state": "MS ","zipcode": "39562",
            "status": "eligible","stage": "new","employee_id": "","reseller_employee_id": "A42526624","role": "EE","group_name": "Coastal Family","branch": null,
            "pcp_id": null,"sku": null,"targeting": 0,
            "sf_id": "0011q00000sS3YSAA0","braze_id": null,"dario_app_uid": null,"app_email": null,"generated_email": 0,"flow_id": 1250,
            "created_at": "2021-08-04T07:28:55.000Z","updated_at": "2021-08-04T07:28:59.000Z",
            "eligible_products": {
                "BP": true,
                "BG": true,
                "MSK": true
            },
            "support_email": "chroniccare@coastalfamilyhealth.org",
            "support_phone": "228.374.4991 ext. 1254"
          }

        let shopdata = {
            orders: [
                {
                    product_type: 'MSK',
                    date: '2020-09-23 12:29',
                    order_id: 75023793,
                    subscription_id: 75023795
                }
            ]
        };

        const apiHandler = require('../../../src/handlers/api-gw-handler');
        eligibility.phone = utils.tryParsePhoneNumber(eligibility.phone);
        await apiHandler.updateEligibilityStatusToEnrolled(eligibility, employer, shopdata);
        expect(states.executeAssignUserToClinicV2).toHaveBeenCalledTimes(1);
        expect(states.executeAssignUserToClinicV2).toHaveBeenCalledWith(
            'rabotasleep+cfhc10@gmail.com',
            [],
            expect.objectContaining({
                phone: null, email:"rabotasleep+cfhc10@gmail.com", first_name:"nastya", last_name:"Cfh49"
            }),
            false,
            expect.anything(),
            expect.anything()
        )
    });

    it('Verifies <updateEligibilityStatusToEnrolled> - provisioning to Dario Clinic - without phone number', async () => {
        const elig_rules = JSON.stringify({
            "productTypes": ["BG","BP","MSK"],
            "validationFields": ["reseller_employee_id", "role", "dob"],
            "provisioning": { "dario": true, "assignToClinic": { "products": ["MSK"], "clinic_auth": "teststring=" } }
        });
        const mapping = { "FirstName": "first_name", "LastName": "last_name", "Email Address": "email", "Phone Number": "phone", "Employee ID": "employee_id", "Vitality ID": "reseller_employee_id", "Role": "role", "Gender": "gender", "Date of Birth": { "key": "dob", "transform": "date:'MM/DD/YYYY'" }, "Branch": "branch", "Group Name": "group_name" };
        let employer = { id: 23, external_id: '99999', mapping_rules: mapping, eligibility_rules: elig_rules };
        let eligibility = {
            "id": 1103,"eid": "725375e6-22c1-4817-95f9-3c02b093694b","employer_id": 23,"first_name": "nastya","last_name": "Cfh49",
            "email": "rabotasleep+cfhc10@gmail.com","shop_email": "rabotasleep+cfhc10@gmail.com","phone": null,"home_phone": null,"shop_phone": null,"gender": "F","dob": "1982-09-07T00:00:00.000Z",
            "address_1": "3200 Dumas Rd","address_2": " ","city": "Moss Point","state": "MS ","zipcode": "39562",
            "status": "eligible","stage": "new","employee_id": "","reseller_employee_id": "A42526624","role": "EE","group_name": "Coastal Family","branch": null,
            "pcp_id": null,"sku": null,"targeting": 0,
            "sf_id": "0011q00000sS3YSAA0","braze_id": null,"dario_app_uid": null,"app_email": null,"generated_email": 0,"flow_id": 1250,
            "created_at": "2021-08-04T07:28:55.000Z","updated_at": "2021-08-04T07:28:59.000Z",
            "eligible_products": {
                "BP": true,
                "BG": true,
                "MSK": true
            },
            "support_email": "chroniccare@coastalfamilyhealth.org",
            "support_phone": "228.374.4991 ext. 1254"
          }

        let shopdata = {
            phone: "+17824920173",
            email: "testqa+gerdau21@mydario.com",
            country: "CA",
            orders: [
                {
                    product_type: 'MSK',
                    date: '2020-09-23 12:29',
                    order_id: 75023793,
                    subscription_id: 75023795
                }
            ]
        };

        const apiHandler = require('../../../src/handlers/api-gw-handler');
        await apiHandler.updateEligibilityStatusToEnrolled(eligibility, employer, shopdata);
        expect(states.executeAssignUserToClinicV2).toHaveBeenCalledTimes(1);
        expect(states.executeAssignUserToClinicV2).toHaveBeenCalledWith(
            'rabotasleep+cfhc10@gmail.com',
            [],
            expect.objectContaining({
                phone: null, email:"rabotasleep+cfhc10@gmail.com", first_name:"nastya", last_name:"Cfh49"
            }),
            false,
            expect.anything(),
            expect.anything()
        )
    })

    it('Verifies <checkEligibility> - basic', async () => {
        let employer = {
            id: 9,
            reseller_id: 6,
            external_id: '20001',
            client_id: null,
            name: 'scof_t',
            status: 'active',
            structure: '{"properties":{"First":{"type":"string","minLength":1},"Last":{"type":"string","minLength":1},"Birth Date":{"type":"string","minLength":1},"Gender":{"type":"string","minLength":1},"Relationship":{"type":"string","minLength":2,"maxLength":2}}}',
            mapping_rules: `{"First":{"key":"first_name","transform":"trim"},"Last":{"key":"last_name","transform":"trim"},"Personal Email":{"key":"email?","transform":"email"},"Mobile":"phone?","Home":"home_phone?","Social Security No\\\\.":"reseller_employee_id","Relationship":{"key":"role","default":"EE"},"Gender":"gender","Birth Date":{"key":"dob","transform":"date:'MM/DD/YYYY'"},"Address":"address_1","Address 2":"address_2","City":"city","State":"state","ZIP Code":"zipcode"}`,
            eligibility_rules: '{"productTypes":["BP","BG","WM"],"validationFields":["first_name","last_name","dob","gender",["phone","email"]],"targeting":{"default":false},"provisioning":{"dario":true}}',
            folder: 'sco',
            file_name_filter: null,
            insurance_claims: null,
            insurance_claims_last_file: null,
            ftp_info: null,
            external_ftp: null,
            ftp_password_creation_date: null,
            support_phone: '999.999.9999',
            support_email: 'name@comp.com',
            braze_stats: null,
            created_at: '2021-09-26T11:54:13.000Z',
            updated_at: '2021-10-13T06:26:49.000Z'
          }
        let reseller = { id: 6, eid: '04GUhZ', name: 'SCO', description: 'SCO Family',
            eligibility_rules: '{"productTypes":["BP","BG","WM"],"validationFields":["first_name","last_name","dob"]}',
            configurations: null, support_phone: '999.999.9999 ext. 1254', support_email: 'chroniccare@coastalfamilyhealth.org',
            created_at: '2021-09-26T11:39:48.000Z'
        }
        let data = {
            role: [ 'EE' ],
            first_name: 'Nitzan',
            middle_name: '',
            last_name: 'Vishnevsky01',
            dob: '1992-07-19',
            address_1: 'Yizhak 4',
            address_2: '',
            city: 'haifa',
            state: 'AK',
            postcode: '444',
            email: 'nitzanv+sco01@mydario.com',
            email_verification: 'nitzanv+sco01@mydario.com',
            phone: '+972528894640',
            gender: 'F',
            eligibility_country: 'US',
            emp: 'sco',
            tid: '',
            sec: '5bc454610c1448b194ce9beedcf90c2b',
            terms: 'on',
            'terms-field': '1'
          }

        db.getEligibilityByFields = jest.fn().mockResolvedValue([[{
            id: 1458, eid: 'dd786ea0-efaa-4139-8bcc-bac47cbb67ee', employer_id: 9,
            first_name: 'Nitzan', last_name: 'Vishnevsky01', email: 'nitzanv+sco01@mydario.com',
            shop_email: null, phone: '-7295', home_phone: '999-999-10000', shop_phone: null,
            gender: 'F', dob: '1992-07-19', address_1: '2061 PITKIN AVENUE',
            address_2: 'APT 1C', city: 'BROOKLYN', state: 'NY', zipcode: '11208',
            status: 'eligible',
            stage: 'new',
            employee_id: '',
            reseller_employee_id: '000-00-0004',
            role: 'EE',
            group_name: null,
            branch: null,
            pcp_id: null,
            braze_id: null,
            dario_app_uid: null,
            app_email: null,
        }]]);

        const apiHandler = require('../../../src/handlers/api-gw-handler');
        let [result] = await apiHandler.checkEligibility([employer], data, reseller);

        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(expect.objectContaining({
            eligible_products: { BP: true, BG: true, WM: true },
            support_email: 'chroniccare@coastalfamilyhealth.org',
            support_phone: '999.999.9999 ext. 1254',
            employer_name: 'scof_t'
        }));
        expect(braze.updateAttributes).toHaveBeenCalledTimes(0);
    })

    it('Verifies <checkEligibility> - different shop email - update braze on match', async () => {
        let employer = {
            id: 9,
            reseller_id: 6,
            external_id: '20001',
            client_id: null,
            name: 'scof_t',
            status: 'active',
            structure: '{"properties":{"First":{"type":"string","minLength":1},"Last":{"type":"string","minLength":1},"Birth Date":{"type":"string","minLength":1},"Gender":{"type":"string","minLength":1},"Relationship":{"type":"string","minLength":2,"maxLength":2}}}',
            mapping_rules: `{"First":{"key":"first_name","transform":"trim"},"Last":{"key":"last_name","transform":"trim"},"Personal Email":{"key":"email?","transform":"email"},"Mobile":"phone?","Home":"home_phone?","Social Security No\\\\.":"reseller_employee_id","Relationship":{"key":"role","default":"EE"},"Gender":"gender","Birth Date":{"key":"dob","transform":"date:'MM/DD/YYYY'"},"Address":"address_1","Address 2":"address_2","City":"city","State":"state","ZIP Code":"zipcode"}`,
            eligibility_rules: '{"productTypes":["BP","BG","WM"],"validationFields":["first_name","last_name","dob","gender",["phone","email"]],"targeting":{"default":false},"provisioning":{"dario":true}}',
            folder: 'sco',
            file_name_filter: null,
            insurance_claims: null,
            insurance_claims_last_file: null,
            ftp_info: null,
            external_ftp: null,
            ftp_password_creation_date: null,
            support_phone: '999.999.9999',
            support_email: 'name@comp.com',
            braze_stats: null,
            created_at: '2021-09-26T11:54:13.000Z',
            updated_at: '2021-10-13T06:26:49.000Z'
          }
        let reseller = { id: 6, eid: '04GUhZ', name: 'SCO', description: 'SCO Family',
            eligibility_rules: '{"productTypes":["BP","BG","WM"],"validationFields":["first_name","last_name","dob"]}',
            configurations: null, support_phone: '999.999.9999 ext. 1254', support_email: 'chroniccare@coastalfamilyhealth.org',
            created_at: '2021-09-26T11:39:48.000Z'
        }
        let data = {
            role: [ 'EE' ],
            first_name: 'Nitzan',
            middle_name: '',
            last_name: 'Vishnevsky01',
            dob: '1992-07-19',
            address_1: 'Yizhak 4',
            address_2: '',
            city: 'haifa',
            state: 'AK',
            postcode: '444',
            email: 'nitzanv+sco99@mydario.com',
            email_verification: 'nitzanv+sco99@mydario.com',
            phone: '+972528894640',
            gender: 'F',
            eligibility_country: 'US',
            emp: 'sco',
            tid: '',
            sec: '5bc454610c1448b194ce9beedcf90c2b',
            terms: 'on',
            'terms-field': '1'
          }

        db.getEligibilityByFields = jest.fn().mockResolvedValue([[{
            id: 1458, eid: 'dd786ea0-efaa-4139-8bcc-bac47cbb67ee', employer_id: 9,
            first_name: 'Nitzan', last_name: 'Vishnevsky01', email: 'nitzanv+sco01@mydario.com',
            shop_email: null, phone: '-7295', home_phone: '999-999-10000', shop_phone: null,
            gender: 'F', dob: '1992-07-19', address_1: '2061 PITKIN AVENUE',
            address_2: 'APT 1C', city: 'BROOKLYN', state: 'NY', zipcode: '11208',
            status: 'eligible',
            stage: 'new',
            employee_id: '',
            reseller_employee_id: '000-00-0004',
            role: 'EE',
            group_name: null,
            branch: null,
            pcp_id: null,
            braze_id: null,
            dario_app_uid: null,
            app_email: null,
        }]]);

        const apiHandler = require('../../../src/handlers/api-gw-handler');
        let [result] = await apiHandler.checkEligibility([employer], data, reseller);

        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(expect.objectContaining({
            eligible_products: { BP: true, BG: true, WM: true },
            support_email: 'chroniccare@coastalfamilyhealth.org',
            support_phone: '999.999.9999 ext. 1254',
            employer_name: 'scof_t'
        }));
        expect(braze.updateAttributes).toHaveBeenCalledTimes(1);
        /*expect(braze.updateAttributes).toHaveBeenCalledWith(
            'nitzanv+sco99@mydario.com',
            {
                email: "nitzanv+sco99@mydario.com",
                b2b_eid: "dd786ea0-efaa-4139-8bcc-bac47cbb67ee",
                b2b_eligibility_stage: "new",
                b2b_eligibility_status: "eligible",
                b2b_employer: "scof_t",
                b2b_employer_id: "20001",
                address_zipcode: "11208"
            }
        );*/
    })

    it('Verifies <getUserForImatByAppEmail> - search user by email', async () => {
        // console.log("start getUserByEmail:");
        // console.log('\n\n\n\n');
        db.getEligibilityByFields = jest.fn().mockResolvedValue([[{
            id: 1458, eid: 'dd786ea0-efaa-4139-8bcc-bac47cbb67ee', employer_id: 9,
            first_name: 'Hi', last_name: 'Test', email: 'hiTest@mydario.com',
            shop_email: null, phone: '-7295', home_phone: '999-999-10000', shop_phone: null,
            gender: 'F', dob: '1992-07-19', address_1: '2061 PITKIN AVENUE',
            address_2: 'APT 1C', city: 'BROOKLYN', state: 'NY', zipcode: '11208',
            status: 'eligible',
            stage: 'new',
            employee_id: '',
            reseller_employee_id: '000-00-0004',
            role: 'EE',
            group_name: null,
            branch: null,
            pcp_id: null,
            braze_id: null,
            dario_app_uid: null,
            app_email: 'hello@mydario.com',
            attribute_1:'teststst',
            attribute_2:null,
            attribute_3:null,
            attribute_4:null,
            attribute_5:null
        }]]);

        db.getEmployerByID = jest.fn().mockResolvedValue([[{
            employer_id: 9,
            external_id: "saddas",
            eligibility_rules: `{"IMATConfiguration":{"enableIMATEvents":true}}`
        }]]);

        const searchHandler = require('../../../src/handlers/api-gw-search-handler');
        let result = await searchHandler.getUserForImatByAppEmail('hello@mydario.com');
        expect(result).not.toEqual(false);
        expect(result.email).toEqual('hello@mydario.com');
        expect(result.employer_id).toEqual('saddas');
        expect(result.mrn).toEqual('teststst');
    })

    it('Verifies <getUserForImatByEid> - search user by eid', async () => {
        console.log("start getUserByEid:");
        console.log('\n\n\n\n');
        db.getEligibilityByFields = jest.fn().mockResolvedValue([[{
            id: 1458, eid: 'dd786ea0-efaa-4139-8bcc-bac47cbb67ee', employer_id: 9,
            first_name: 'Hi', last_name: 'Test', email: 'hiTest@mydario.com',
            shop_email: null, phone: '-7295', home_phone: '999-999-10000', shop_phone: null,
            gender: 'F', dob: '1992-07-19', address_1: '2061 PITKIN AVENUE',
            address_2: 'APT 1C', city: 'BROOKLYN', state: 'NY', zipcode: '11208',
            status: 'eligible',
            stage: 'new',
            employee_id: '',
            reseller_employee_id: '000-00-0004',
            role: 'EE',
            group_name: null,
            branch: null,
            pcp_id: null,
            braze_id: null,
            dario_app_uid: null,
            app_email: 'hello@mydario.com',
            attribute_1:'teststst',
            attribute_2:null,
            attribute_3:null,
            attribute_4:null,
            attribute_5:null
        }]]);

        db.getEmployerByID = jest.fn().mockResolvedValue([[{
            employer_id: 9,
            external_id: "saddas",
            eligibility_rules: `{"IMATConfiguration":{"enableIMATEvents":true}}`
        }]]);

        const searchHandler = require('../../../src/handlers/api-gw-search-handler');
        let result = await searchHandler.getUserForImatByEid('dd786ea0-efaa-4139-8bcc-bac47cbb67e');
        expect(result).not.toEqual(false);
        expect(result.eid).toEqual('dd786ea0-efaa-4139-8bcc-bac47cbb67e');
        expect(result.employer_id).toEqual('saddas');
        expect(result.mrn).toEqual('teststst');
    })

    it('Verifies <handleAPISearchRequest> - search user by email', async () => {
        db.getEligibilityByFields = jest.fn().mockResolvedValue([[{
            id: 1458, eid: 'dd786ea0-efaa-4139-8bcc-bac47cbb67ee', employer_id: 9,
            first_name: 'Hi', last_name: 'Test', email: 'hiTest@mydario.com',
            shop_email: null, phone: '-7295', home_phone: '999-999-10000', shop_phone: null,
            gender: 'F', dob: '1992-07-19', address_1: '2061 PITKIN AVENUE',
            address_2: 'APT 1C', city: 'BROOKLYN', state: 'NY', zipcode: '11208',
            status: 'eligible',
            stage: 'new',
            employee_id: '',
            reseller_employee_id: '000-00-0004',
            role: 'EE',
            group_name: null,
            branch: null,
            pcp_id: null,
            braze_id: null,
            dario_app_uid: null,
            app_email: 'hello@mydario.com',
            attribute_1:'teststst',
            attribute_2:null,
            attribute_3:null,
            attribute_4:null,
            attribute_5:null
        }]]);

        db.getEmployerByID = jest.fn().mockResolvedValue([[{
            employer_id: 9,
            external_id: "saddas"
        }]]);

        const searchHandler = require('../../../src/handlers/api-gw-search-handler');
        let result = await searchHandler.handleAPISearchRequest({
            requestContext: {operationName: 'search'},
            body: '{"entity":"user","query_param":"app_email","value":"hello@mydario.com"}'
        });
        expect(result).not.toEqual(false);
        expect(result.statusCode).toEqual(200);
    })

    it('Verifies <AssignUserToClinicV2> - no assignments on empty targets', async () => {
        let email = 'test@example.com';
        let targets = [];
        let orders = [];
        let eligibility = {};
        let rules = {}
        const apiHandler = require('../../../src/handlers/api-gw-handler');
        await apiHandler.AssignUserToClinicV2(email, targets, eligibility, orders, rules);

        expect(states.executeAssignUserToClinicV2).toHaveBeenCalledTimes(0);
    })

    it('Verifies <AssignUserToClinicV2> - no assignments on empty targets non empty orders', async () => {
        let email = 'test@example.com';
        let targets = [];
        let orders = [{
            product_type: 'MSK',
            date: '2020-09-23 12:29',
            order_id: 75023793,
            subscription_id: 75023795
        }];
        let eligibility = {};
        let rules = {}
        const apiHandler = require('../../../src/handlers/api-gw-handler');
        await apiHandler.AssignUserToClinicV2(email, targets, eligibility, orders, rules);

        expect(states.executeAssignUserToClinicV2).toHaveBeenCalledTimes(1);
    })

    it('Verifies <AssignUserToClinicV2> - no assignments on matching target', async () => {
        let email = 'test@example.com';
        let targets = [{
            "product": "MSK",
            "system": "upright",
            "clinic_auth": "cEJ6RlVGV29tNGx0===="
        }];
        let orders = [{
            product_type: 'MSK',
            date: '2020-09-23 12:29',
            order_id: 75023793,
            subscription_id: 75023795
        }];
        let eligibility = {};
        let isMinor = false
        let shopdata = {}
        let rules = {}
        const apiHandler = require('../../../src/handlers/api-gw-handler');
        await apiHandler.AssignUserToClinicV2(email, targets, eligibility, orders, isMinor, shopdata, rules);

        expect(states.executeAssignUserToClinicV2).toHaveBeenCalledTimes(1);
        expect(states.executeAssignUserToClinicV2).toHaveBeenCalledWith(
            email,
            targets,
            eligibility,
            isMinor,
            shopdata,
            rules
        );
    })

    it('Verifies <checkEligibility-minor> - with parent app_email', async () => {
        let employer = {
            id: 17,
            reseller_id: 14,
            external_id: '20007',
            client_id: null,
            name: 'union_pacific_t',
            status: 'active',
            structure: '{"properties":{"First Name":{"type":"string","minLength":1},"Last Name":{"type":"string","minLength":1},"Date of Birth":{"type":"string","minLength":1},"Gender":{"type":"string","minLength":1}}}',
            mapping_rules: `{"First Name":{"key":"first_name","transform":"trim"},"Last Name":{"key":"last_name","transform":"trim"},"Work Email":{"key":"email?","transform":"email"},"Mobile Phone":"phone?","Member ID":"reseller_employee_id","Relationship":{"key":"role","default":"UN"},"Gender":"gender","Birth Date":{"key":"dob","transform":"date:'MM/DD/YYYY'"},"Address":"address_1","Address 2":"address_2","City":"city","State":"state","ZIP Code":"zipcode"}`,
            eligibility_rules: '{"productTypes":["BP","BG","WM"],"validationFields":["first_name","last_name","dob","gender"],"targeting":{"default":true,"minor_age":18},"provisioning":{"dario":true}}',
            folder: 'union_pacific',
            file_name_filter: null,
            insurance_claims: null,
            insurance_claims_last_file: null,
            ftp_info: null,
            external_ftp: null,
            ftp_password_creation_date: null,
            support_phone: '999.999.9999',
            support_email: 'name@union_pacific.com',
            braze_stats: null,
            created_at: '2022-02-07T11:54:13.000Z',
            updated_at: '2022-02-07T06:26:49.000Z'
          }
        let reseller = { id: 14, eid: 'cYig1U', name: 'Union Pacific', description: 'Union Pacific',
            eligibility_rules: '{"productTypes":["BP","BG","WM"],"validationFields":["first_name","last_name","dob","gender"]}',
            configurations: null, support_phone: '999.999.9999 ext. 1254', support_email: 'chroniccare@union_pacific.org',
            created_at: '2022-02-01T11:39:48.000Z'
        }
        let data = {
            role: [ 'CH' ],
            first_name: 'NASTYA',
            middle_name: '',
            last_name: 'TEST-U04',
            dob: '2014-01-27',
            address_1: 'Yizhak 4',
            address_2: '',
            city: 'haifa',
            state: 'AK',
            postcode: '444',
            email: 'testqa+uptest112@mydario.com',
            email_verification: 'testqa+uptest112@mydario.com',
            phone: '+972528894640',
            gender: 'F',
            eligibility_country: 'US',
            emp: 'union_pacific_t',
            tid: '',
            sec: '5bc454610c1448b194ce9beedcf90c2b',
            terms: 'on',
            'terms-field': '1'
          }

        db.getEligibilityByFields = jest.fn().mockResolvedValue([[{
            id: 2808, eid: '124aa3e1-0cf7-4f90-a7e6-e13df2aad6c8', employer_id: 17,
            first_name: 'NASTYA', last_name: 'TEST-U04', email: 'testqa+uptest112@mydario.com',
            shop_email: null, phone: '-7295', home_phone: '999-999-10000', shop_phone: null,
            gender: 'F', dob: '2014-01-27', address_1: '2061 PITKIN AVENUE',
            address_2: 'APT 1C', city: 'BROOKLYN', state: 'NY', zipcode: '11208',
            status: 'eligible',
            stage: 'new',
            employee_id: '',
            reseller_employee_id: '00570449NastyaTest00304500',
            role: 'CH',
            group_name: null,
            branch: null,
            pcp_id: null,
            braze_id: null,
            dario_app_uid: null,
            app_email: null,
        }]]);

        db.getEligibilityByResellerRoleEmpId = jest.fn().mockResolvedValue([[{
            id: 2855, eid: 'acf3139b-4427-4e5f-8b3a-cdc29b8d973f', employer_id: 17,
            first_name: 'NASTYA', last_name: 'Test121', email: 'testqa+uptest113@mydario.com',
            shop_email: null, phone: '-7295', home_phone: '999-999-10000', shop_phone: null,
            gender: 'F', dob: '2000-01-01', address_1: '2061 PITKIN AVENUE',
            address_2: 'APT 1C', city: 'BROOKLYN', state: 'NY', zipcode: '11208',
            status: 'eligible',
            stage: 'new',
            employee_id: '',
            reseller_employee_id: '00570449NastyaTest00304500',
            role: 'EE',
            group_name: null,
            branch: null,
            pcp_id: null,
            braze_id: null,
            dario_app_uid: null,
            app_email: 'testqa+uptest113@mydario.com',
            shop_phone: null
        }]])

        const apiHandler = require('../../../src/handlers/api-gw-handler');
        let [result] = await apiHandler.checkEligibility([employer], data, reseller);

        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result[0].parent).toEqual(expect.objectContaining({
            app_email:'testqa+uptest113@mydario.com', shop_phone: null
        }));
    })

    it('Verifies <checkEligibility-solera> - creates new eligibility in database and sends queue event for referrals', async () => {
        let employer = {
            id: 31,
            reseller_id: 25,
            external_id: '20020',
            client_id: null,
            sf_eligbility_account_ID: null,
            name: 'solera_t',
            status: 'active',
            structure: null,
            mapping_rules: null,
            eligibility_rules: `{
                "productTypes": [
                    "BP"
                ],
                "validationFields": [
                    "first_name",
                    "last_name",
                    "dob",
                    "attribute_1"
                ],
                "behaviors": [
                    "autoCreateEligibility"
                ],
                "provisioning": {
                    "dario": true
                },
                "membership": {
                    "membership_plan": "MEMBER_B2B",
                    "clinic": "10020",
                    "clinic_meta": {
                        "channel": "Solera",
                        "sub_channel": ""
                    },
                    "display_name": "Solera",
                    "checkup_call_expert": "expert2",
                    "contact_us_email": "service@dariohealth.com",
                    "contact_us_phone": "1-888-408-4125"
                },
                "membershipDisabled": {
                    "membership_plan": "",
                    "clinic": null,
                    "clinic_meta": null,
                    "display_name": null,
                    "checkup_call_expert": null,
                    "contact_us_email": null,
                    "contact_us_phone": null
                }
            }`,
            folder: '',
            file_name_filter: null,
            record_source: null,
            parser_structure: null,
            insurance_claims: null,
            insurance_claims_last_file: null,
            ftp_info: null,
            external_ftp: null,
            ftp_password_creation_date: null,
            support_phone: null,
            support_email: null,
            braze_stats: null,
            launch_date: '2023-02-01T10:35:55.000Z',
            created_at: '2022-06-30T08:37:47.000Z',
            updated_at: '2023-01-09T08:58:18.000Z',
            enrollment_setup: null,
            file_path: null,
            b2b_link: null,
            kickoff_link: null,
            epic_link: null,
            eid: '1NpPi0',
            reseller_b2b_link: null,
            reseller_kickoff_link: null,
            reseller_epic_link: null
        }
        let reseller = { id: 25, eid: '1NpPi0', name: 'Solera', description: 'Solera',
            eligibility_rules: `{
                "productTypes": [
                    "BP"
                ],
                "validationFields": [
                    "first_name",
                    "last_name",
                    "dob",
                    "attribute_1"
                ],
                "behaviors": [
                    "autoCreateEligibility"
                ],
                "provisioning": {
                    "dario": true
                },
                "membership": {
                    "membership_plan": "MEMBER_B2B",
                    "clinic": "10020",
                    "clinic_meta": {
                        "channel": "Solera",
                        "sub_channel": ""
                    },
                    "display_name": "Solera",
                    "checkup_call_expert": "expert2",
                    "contact_us_email": "service@dariohealth.com",
                    "contact_us_phone": "1-888-408-4125"
                },
                "membershipDisabled": {
                    "membership_plan": "",
                    "clinic": "",
                    "clinic_meta": {
                        "channel": "",
                        "sub_channel": ""
                    },
                    "display_name": "",
                    "checkup_call_expert": "",
                    "contact_us_email": "",
                    "contact_us_phone": ""
                }
            }`,
            configurations: null,
            support_phone: null,
            support_email: null,
            launch_date: '2023-02-01T10:36:38.000Z',
            created_at: '2022-06-30T08:35:11.000Z',
            b2b_link: null,
            kickoff_link: null,
            epic_link: null
          }
        let data = {
            first_name: 'Lucille',
            reseller_employee_id: 'd8611115950e42c188aae73a',
            last_name: 'Kassulke',
            gender: 'F',
            selectedMonth: 4,
            selectedDay: 4,
            selectedYear: 1995,
            terms: true,
            phone: '+18435550960',
            address_1: '111 w monroe St',
            city: 'Phoenix',
            state: 'AZ',
            postcode: '85003',
            email: 'adam.manternach+202211096245595@soleranetwork.com',
            dob: '1995-04-04',
            country: 'US',
            attribute_1: 'd8611115950e42c188aae73a',
            attribute_2: 'HTN',
            attribute_3: 'Hypertension',
            attribute_4: 'M5HTN1'
          }

        db.getEmployerByID = jest.fn().mockResolvedValue([[employer]]);
        db.getEligibilityByFields = jest.fn().mockResolvedValue([[]]);
        db.getEligibilityById = jest.fn().mockResolvedValue([[{
            id: 2855, eid: 'acf3139b-4427-4e5f-8b3a-cdc29b8d973f', employer_id: 17,
            first_name: 'NASTYA', last_name: 'Test121', email: 'testqa+uptest113@mydario.com',
            shop_email: null, phone: '-7295', home_phone: '999-999-10000', shop_phone: null,
            gender: 'F', dob: '2000-01-01', address_1: '2061 PITKIN AVENUE',
            address_2: 'APT 1C', city: 'BROOKLYN', state: 'NY', zipcode: '11208',
            status: 'eligible',
            stage: 'new',
            employee_id: '',
            reseller_employee_id: '00570449NastyaTest00304500',
            role: 'EE',
            group_name: null,
            branch: null,
            pcp_id: null,
            braze_id: null,
            dario_app_uid: null,
            app_email: 'testqa+uptest113@mydario.com',
            shop_phone: null
        }]]);

        const apiHandler = require('../../../src/handlers/api-gw-handler');
        let [result] = await apiHandler.checkEligibility([employer], data, reseller);

        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(expect.objectContaining({
            app_email:'testqa+uptest113@mydario.com',
            shop_phone: null
        }));
        // expect(db.updateEligibilitySalesForceIDTrx).toHaveBeenCalled();
        // expect(db.updateEligibilitySalesForceIDTrx).toHaveBeenCalledWith('0011q00000b2kwIAAQ', 1, 999);
        expect(sf.createOrUpdateEligibility).not.toHaveBeenCalled();
        expect(queue.sendMessage).toHaveBeenCalled();
    })

    it('Choose rules set', async () => {
        let form_data = {
            first_name: 'Jerry',
            last_name: 'Seinfeld',
            email: 'jerry@corp.com'
        };
        let rules = {
            validationFields: ['first_name', 'last_name', 'email']
        }

        const apiHandler = require('../../../src/handlers/api-gw-handler');

        let result = await apiHandler.chooseRulesSet(form_data, rules);
        expect(result.validationFields).toEqual(['first_name', 'last_name', 'email']);
    });

    it('Choose rules set', async () => {
        let form_data = {
            first_name: 'Jerry',
            last_name: 'Seinfeld',
            email: 'jerry@corp.com'
        };
        let rules = {
            validationFields: ['first_name', 'last_name', ['email']]
        }

        const apiHandler = require('../../../src/handlers/api-gw-handler');

        let result = await apiHandler.chooseRulesSet(form_data, rules);
        expect(result.validationFields).toEqual(['first_name', 'last_name', ['email']]);
    });

    it('Choose rules set - return both rules', async () => {
        let form_data = {
            first_name: 'Jerry',
            last_name: 'Seinfeld',
            email: 'jerry@corp.com',
            eid: '1234'
        };
        let rules = {
            validationFields: [['eid'],['first_name', 'last_name']]
        }

        const apiHandler = require('../../../src/handlers/api-gw-handler');

        let result = await apiHandler.chooseRulesSet(form_data, rules);
        expect(result.validationFields).toEqual([['eid'],['first_name', 'last_name']]);
    });

    it('Choose rules set - first array was matched (missing last_name in form_data)', async () => {
        let form_data = {
            first_name: 'Jerry',
            eid: '1234'
        };
        let rules = {
            validationFields: [['eid'],['first_name', 'last_name']]
        }

        const apiHandler = require('../../../src/handlers/api-gw-handler');

        let result = await apiHandler.chooseRulesSet(form_data, rules);
        expect(result.validationFields).toEqual([['eid']]);
    });

    it('Choose rules set - second array was matched (missing phone param in form_data)', async () => {
        let form_data = {
            first_name: 'Jerry',
            last_name: 'Seinfeld',
            email: 'jerry@corp.com',
            eid: '1234'
        };
        let rules = {
            validationFields: [['eid','phone'],['first_name', 'last_name']]
        }

        const apiHandler = require('../../../src/handlers/api-gw-handler');

        let result = await apiHandler.chooseRulesSet(form_data, rules);
        expect(result.validationFields).toEqual([['first_name', 'last_name']]);
    });

    it('Choose rules set - return default rules in case of required rules not appeared in form data', async () => {
        let form_data = {
            first_name: 'Jerry',
            eid: '1234'
        };
        let rules = {
            validationFields: [['eid','phone'],['first_name', 'last_name']]
        }

        const apiHandler = require('../../../src/handlers/api-gw-handler');

        let result = await apiHandler.chooseRulesSet(form_data, rules);
        expect(result.validationFields).toEqual(['eid','phone']);
    });

    // it('Verifies <reenrollEligibility> - runs auto reenrol', async () => {
    //     const { EligibilityStatus, EligibilityStage, Behaviors } = constants;
    //     const eligibilityRules = {
    //         behaviors: [Behaviors.REENROLLMENT],
    //         behaviorsParams: {
    //             reenrollment: {
    //                 manualPeriod: 60,
    //                 autoPeriod: 30,
    //             },
    //         },
    //     };

    //     const msInOneDay = 1000 * 60 * 60 * 24
    //     const today = new Date()
    //     const disenrolled_at = new Date(today - 29 * msInOneDay)

    //     const eligibilityRecord = {
    //         stage: EligibilityStage.INELIGIBLE,
    //         status: EligibilityStatus.INELIGIBLE,
    //         disenrolled_at, //2023-06-12 07:12:23
    //         id: 'test_id',
    //     };

    //     const apiHandler = require('../../../src/handlers/api-gw-handler');

    //     await apiHandler.reenrollEligibility(eligibilityRecord, eligibilityRules)
    //     expect(db.updateEligibilityStatusTrx).toHaveBeenCalledTimes(1);
    //     expect(db.addEligibilityLog).toHaveBeenCalledTimes(1);
    //     expect(db.updateRedeemedProductsStatus).toHaveBeenCalledTimes(1);
    // });

    // it('Verifies <reenrollEligibility> - dont runs reenrol', async () => {
    //     const { EligibilityStatus, EligibilityStage, Behaviors } = constants;
    //     const eligibilityRules = {
    //         behaviors: [Behaviors.REENROLLMENT],
    //         behaviorsParams: {
    //             reenrollment: {
    //                 manualPeriod: 60,
    //                 autoPeriod: 30,
    //             },
    //         },
    //     };

    //     const msInOneDay = 1000 * 60 * 60 * 24
    //     const today = new Date()
    //     const disenrolled_at = new Date(today - 45 * msInOneDay)

    //     const eligibilityRecord = {
    //         stage: EligibilityStage.INELIGIBLE,
    //         status: EligibilityStatus.INELIGIBLE,
    //         disenrolled_at, //2023-06-12 07:12:23
    //         id: 'test_id',
    //     };

    //     const apiHandler = require('../../../src/handlers/api-gw-handler');

    //     await apiHandler.reenrollEligibility(eligibilityRecord, eligibilityRules)
    //     expect(db.updateEligibilityStatusTrx).toHaveBeenCalledTimes(0);
    //     expect(db.addEligibilityLog).toHaveBeenCalledTimes(0);
    //     expect(db.updateRedeemedProductsStatus).toHaveBeenCalledTimes(0);
    // });

    // it('Verifies <reenrollEligibility> - runs manual reenrol', async () => {
    //     const { EligibilityStatus, EligibilityStage, Behaviors } = constants;
    //     const eligibilityRules = {
    //         behaviors: [Behaviors.REENROLLMENT],
    //         behaviorsParams: {
    //             reenrollment: {
    //                 manualPeriod: 60,
    //                 autoPeriod: 30,
    //             },
    //         },
    //     };

    //     const msInOneDay = 1000 * 60 * 60 * 24
    //     const today = new Date()
    //     const disenrolled_at = new Date(today - 61 * msInOneDay)

    //     const eligibilityRecord = {
    //         stage: EligibilityStage.INELIGIBLE,
    //         status: EligibilityStatus.INELIGIBLE,
    //         disenrolled_at, //2023-06-12 07:12:23
    //         id: 'test_id',
    //     };

    //     const apiHandler = require('../../../src/handlers/api-gw-handler');

    //     await apiHandler.reenrollEligibility(eligibilityRecord, eligibilityRules)
    //     expect(db.updateEligibilityStatusTrx).toHaveBeenCalledTimes(1);
    //     expect(db.addEligibilityLog).toHaveBeenCalledTimes(1);
    //     expect(db.updateRedeemedProductsStatus).toHaveBeenCalledTimes(1);
    // });

    it('Verifies <addProductEigibilityInfo> - add right eligibility_products with reenrolled status', async () => {
        const productTypes = ["BP", "BG", "WM", "BH", "MSK_PST"]
        const eligibility = { id: 'eligibility_list_id', stage: "enrolled"   }
        db.getRedeemedProductsList = jest.fn().mockResolvedValue([[{ product_type: 'BP', status: 'reenrolled' }, { product_type: 'BG' }, { product_type: 'WM' }], []]);
        const apiHandler = require('../../../src/handlers/api-gw-handler');

        const result = await apiHandler.addProductEigibilityInfo(productTypes, eligibility)
        expect(result).toEqual(expect.objectContaining({
            id: 'eligibility_list_id',
            eligible_products: {
                BP: false, // as we are expecting false for re-enrolled products
                BG: false,
                WM: false,
                BH: true,
                MSK_PST: true,
            }
        }))
    });
})
