const emailSrv = require('../../../src/services/email-service');

describe('Test for s3-csv-handler', () => {
    beforeAll(() => {
        //email
        emailSrv.sendEmailWithAttachment = jest.fn().mockResolvedValue({ messageId: 'b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com', success: true, errors: [] });
        emailSrv.sendEmail = jest.fn().mockResolvedValue({ messageId: 'b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com', success: true, errors: [] });

        //omit logging
        console.log = jest.fn();
        console.error = jest.fn();
    })

    afterAll(() => {
    })

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('Verifies html templats are loaded', async () => {
        expect(emailSrv.getTemplate('processing')).toEqual(expect.stringContaining('<html'));
        expect(emailSrv.getTemplate('reconciliation')).toEqual(expect.stringContaining('<html'));
    });

});
