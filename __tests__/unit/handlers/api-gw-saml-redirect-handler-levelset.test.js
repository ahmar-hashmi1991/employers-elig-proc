const db = require('../../../src/services/rds-data-service');
const secrets = require('../../../src/services/secrets-service');
const jwt = require('jsonwebtoken');
let {event} = require('../../saml-redirect/saml-request-levelset.json');
const request = require('supertest');

const elig_rule = { productTypes: ["BG", "BP"], validationFields: ["reseller_employee_id", "role", "dob"] }
const EMPLOYER = { id: 23, reseller_id: 1, external_id: '12345', eligibility_rules: elig_rule };
const RESELLER = { 
    id: 19, eid: 'qs42Md', name: 'LevelSet', description:"LevelSet", 
    eligibility_rules: {"productTypes": ["BG", "BP"],validationFields: ["eid"]},
    configurations: '{"sso":{"cert_filename":"certs/auth_uat_grandrounds_com-metadata_SelfSigned_ExpiresApr2025.txt"}}'
}
const ELIGIBILITY = { 
    "id": 1970, "eid": "d701a63b-bea0-4b35-a908-25e2125ac6ee", "employer_id": 14, 
    "first_name": "Dario1", "last_name": "Dario1", 
    "email": "vptestdario1@vptest.com", "shop_email":"testqa+doriavp@vptest.com",
    "phone": null, "home_phone": null, "shop_phone": "+12526785855", "gender": "F", "dob": "1990-01-01T00:00:00.000Z", 
    "address_1":"VIRGIV1","address_2":"VIRGIV2","city":"BROOKLYN","state":"NY","country":null,"zipcode":"44444",
    "status": "eligible", "stage": "new", 
    "employee_id": "123682", "reseller_employee_id": "VS00123683", 
    "role": "EE", "group_name": "ABC COMPANY", "branch": "TEST", 
    "sf_id": "0011q00000bhEATAA2", "braze_id": null, "dario_app_uid": null, "app_email": null, 
    "created_at": "2020-09-23T12:21:57.000Z", "updated_at": "2020-09-23T12:21:57.000Z", 
    "attribute_1": null, "attribute_2": null, "attribute_3": null, "attribute_4": null, "attribute_5": null 
}

describe('Test for api-gw-saml-redirect-handler', () => {

    beforeAll(() => {
        db.getResellerByExternalID = jest.fn().mockResolvedValue([[RESELLER], []]);
        db.getEmployer = jest.fn().mockResolvedValue([[EMPLOYER], []]);
        db.getEligibilityByFields = jest.fn().mockResolvedValue([[ELIGIBILITY], []]);
        db.updateEligibility = jest.fn().mockResolvedValue([{ affectedRows: 1, changedRows: 1 }]);

        secrets.getSecret = jest.fn().mockResolvedValue({ id_rsa: 'ZGFyaW90ZXN0c3VpdGU' });

        jwt.sign = jest.fn().mockResolvedValue();
        const sign = jest.spyOn(jwt, 'sign');
        sign.mockImplementation(() => ("ZGFyaW90ZXN0c3VpdGUZGFyaW90ZXN0c3VpdGUZGFyaW90ZXN0c3VpdGUZGFy"));
        //omit logging
        console.log = jest.fn();
    })

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('Verifies <LevelSet SAML response> - redirect correctly', async() => {
        
        process.env.STAGE = 'prod';
        process.env.EligiblityLandingPageHost = 'https://stage-be.dariohealth.com';
        process.env.UTEST = true;
        
        const apiSAMLRedirectHandler = require('../../../src/handlers/api-gw-saml-redirect-handler');

        // console.warn(event.body)
        
        let response = await request(apiSAMLRedirectHandler.express_app).post('/reseller/qs42Md/saml').send(event.body);
        //console.warn(JSON.stringify(response));
        expect(response.status).toEqual(303);
        expect(response.header.location).toEqual(process.env.EligiblityLandingPageHost + "/emp/12345?auth=ZGFyaW90ZXN0c3VpdGUZGFyaW90ZXN0c3VpdGUZGFyaW90ZXN0c3VpdGUZGFy");
    });    

})