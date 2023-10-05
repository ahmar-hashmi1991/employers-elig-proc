const secrets = require('../../../src/services/secrets-service');

const mockUpdate = jest.fn().mockResolvedValue({status: 'mock success'});

describe('Test for salesforce service', () => {
    beforeAll(() => {
        console.log = jest.fn();
    });

    beforeEach(() => {
        secrets.getSecret = jest.fn().mockResolvedValue({url: 'https://', token: 'xtoken'});

        jest.mock('jsforce', () => {
            class mockJsforce {
                login(u,p,cb) {
                    console.log('mock login...');
                    cb();
                }
                query(soql) {
                    return Promise.resolve({ records: [] });
                }
                sobject(type) {
                    class SFQueryResult extends Promise {
                        update = mockUpdate;
                    }
                    return {
                        find: (query) => SFQueryResult.resolve([{ Id: '111111' }]),
                        retrieve: (query) => SFQueryResult.resolve([{ Id: '111111' }]),
                    };
                }
            }
            return {
                Connection: mockJsforce
            };
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('Verifies createOrUpdateEligibility - sends mobile phone to SF', async () => {
        const sforce = require('../../../src/services/salesforce-service');
        await sforce.createOrUpdateEligibility('sf_id', '1234', 'test@mail.com', 'John', 'Smith', '1899-11-30',null, '18003435625', null, 'emp_name', '123', 'eligible', 'new', 1, null);

        expect(mockUpdate).toHaveBeenCalled();
        expect(mockUpdate).toBeCalledWith(
            expect.objectContaining({
                PersonMobilePhone: '18003435625'
            })
        )
    });

    it('Verifies createOrUpdateEligibility - dont sends mobile phone to SF if null', async () => {
        const sforce = require('../../../src/services/salesforce-service');
        await sforce.createOrUpdateEligibility('sf_id', '1234', 'test@mail.com', 'John', 'Smith', '1899-11-30',null, null, null, 'emp_name', '123', 'eligible', 'new', 1, null);

        expect(mockUpdate).toHaveBeenCalled();
        expect(mockUpdate).toBeCalledWith(
            expect.not.objectContaining({
                PersonMobilePhone: null
            })
        )
    });

    it('Verifies createOrUpdateEligibility - sends BirthDay to SF', async () => {
        const sforce = require('../../../src/services/salesforce-service');
        await sforce.createOrUpdateEligibility('sf_id', '1234', 'test@mail.com', 'John', 'Smith', '1899-11-30',null, '18003435625', null, 'emp_name', '123', 'eligible', 'new', 1, null);

        expect(mockUpdate).toHaveBeenCalled();
        expect(mockUpdate).toBeCalledWith(
            expect.objectContaining({
                PersonBirthdate: '1899-11-30'
            })
        )
    });

    it('Verifies createOrUpdateEligibility - Dont sends BirthDay to SF', async () => {
        const sforce = require('../../../src/services/salesforce-service');
        await sforce.createOrUpdateEligibility('sf_id', '1234', 'test@mail.com', 'John', 'Smith', null, null, '18003435625', null, 'emp_name', '123', 'eligible', 'new', 1, null);

        expect(mockUpdate).toHaveBeenCalled();
        expect(mockUpdate).toBeCalledWith(
            expect.objectContaining({
                PersonBirthdate: null
            })
        )
    });

    it('Verifies updateSFFlags - Update the value of flags on SalesForce', async () => {
        const sforce = require('../../../src/services/salesforce-service');
        const flags = {
            activate_grocery_scanner: false,
            activate_healthkit_observers: true,
            activate_prescription_manager: false
        }
        await sforce.updateSFFlags(null, flags);

        expect(mockUpdate).toHaveBeenCalled();
        expect(mockUpdate).toBeCalledWith(
            expect.objectContaining({
            })
        )
    });
})