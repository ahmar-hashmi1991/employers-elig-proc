const db = require('../../../src/services/rds-data-service');
const redis = require('../../../src/services/redis-service');
const docdb = require('../../../src/services/document-db-service');

const Eligibility = {
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
};

describe('Test for api-gw-firewall-handler', () => {

    beforeAll(() => {
        db.beginTransaction = jest.fn();
        db.commit = jest.fn();
        db.rollback = jest.fn();
        db.end = jest.fn();
        db.getEligibilityByFields = jest.fn().mockResolvedValue([[], []]);
        docdb.getMasterRecord = jest.fn().mockResolvedValue({});
        redis.get = jest.fn().mockResolvedValue(false);
        redis.set = jest.fn();
        //omit logging
        console.log = jest.fn();
    });

    afterEach(() => {
        db.getEligibilityByFields = jest.fn().mockResolvedValue([[], []]);
        docdb.getMasterRecord = jest.fn().mockResolvedValue({});
        redis.get = jest.fn().mockResolvedValue(false);
        jest.clearAllMocks();
    });

    it('Verifies <getMasterRecordType> - throws error when email is not found at all', async () => {
        const apiFWHandler = require('../../../src/handlers/api-gw-firewall-handler');
        try{
            let type = await apiFWHandler.getMasterRecordType(`${Eligibility.email}`);
            //if we got here we need to throw Unexpected Error
            let err = new Error("Unexpected Error");
            err.code = 503;
            throw err;
        }catch(e){
            expect(e).toHaveProperty('code', 404);
        }
    });
    
    it('Verifies <getMasterRecordType> - returns correct `B2C` type when found as B2C in the FW DB and not found in Eligiblity DB', async () => {
        docdb.getMasterRecord = jest.fn().mockResolvedValue({type:'B2C'});
        const apiFWHandler = require('../../../src/handlers/api-gw-firewall-handler');
        let type = await apiFWHandler.getMasterRecordType(Eligibility.email);
        expect(db.getEligibilityByFields).toHaveBeenCalledTimes(1);
        expect(docdb.getMasterRecord).toHaveBeenCalledTimes(1);
        expect(type).toEqual('B2C');
    });
    
    it('Verifies <getMasterRecordType> - returns correct `B2B` type when found as B2C in the FW DB and found in Eligiblity DB', async () => {
        db.getEligibilityByFields = jest.fn().mockResolvedValue([[Eligibility], []]);
        docdb.getMasterRecord = jest.fn().mockResolvedValue({type:'B2C'});
        const apiFWHandler = require('../../../src/handlers/api-gw-firewall-handler');
        let type = await apiFWHandler.getMasterRecordType(Eligibility.email);
        expect(db.getEligibilityByFields).toHaveBeenCalledTimes(1);
        expect(docdb.getMasterRecord).toHaveBeenCalledTimes(1);
        expect(type).toEqual('B2B');
    });
    
    it('Verifies <getMasterRecordType> - returns correct `B2B` type when found as B2B in the FW DB and don`t query the Eligibility DB', async () => {
        //not found in cache and type is B2C in the master_records
        docdb.getMasterRecord = jest.fn().mockResolvedValue({type:'B2B'});
        const apiFWHandler = require('../../../src/handlers/api-gw-firewall-handler');
        let type = await apiFWHandler.getMasterRecordType(Eligibility.email);
        expect(db.getEligibilityByFields).toHaveBeenCalledTimes(0);
        expect(docdb.getMasterRecord).toHaveBeenCalledTimes(1);
        expect(type).toEqual('B2B');
    });
    
    it('Verifies <getMasterRecordType> - returns correct `B2B` type when not found in the FW DB and found in Eligiblity DB', async () => {
        db.getEligibilityByFields = jest.fn().mockResolvedValue([[Eligibility], []]);
        //not found in cache and type is B2C in the master_records
        const apiFWHandler = require('../../../src/handlers/api-gw-firewall-handler');
        let type = await apiFWHandler.getMasterRecordType(Eligibility.email);
        expect(db.getEligibilityByFields).toHaveBeenCalledTimes(1);
        expect(docdb.getMasterRecord).toHaveBeenCalledTimes(1);
        expect(type).toEqual('B2B');
    });
    
    it('Verifies <getMasterRecordType> - returns correct type without calling the DBs when found in redis cache', async () => {
        let cache_result = JSON.stringify({type:'B2C'});
        redis.get = jest.fn().mockResolvedValue(cache_result);
        //not found in cache and type is B2C in the master_records
        const apiFWHandler = require('../../../src/handlers/api-gw-firewall-handler');
        let type = await apiFWHandler.getMasterRecordType(Eligibility.email);
        expect(db.getEligibilityByFields).toHaveBeenCalledTimes(0);
        expect(docdb.getMasterRecord).toHaveBeenCalledTimes(0);
        expect(type).toEqual('B2C');
    });

})