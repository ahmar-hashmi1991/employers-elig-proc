const secrets = require('../../../src/services/secrets-service');

describe('Test for sftp-auth-handler', () => {
    const OLD_ENV = process.env;

    beforeAll(() => {
        //omit logging
        console.log = jest.fn();
    })

    beforeEach(() => {
        process.env = { ...OLD_ENV }; // make a copy
        process.env.ROLE_ARN = 'arn::role';
        process.env.BUCKET_NAME = 'mybucket';
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    afterAll(() => {
        process.env = OLD_ENV; // restore old env
    });

    it('Verifies sftp authentication success with no whitelist', async () => {
        const authenticator = require('../../../src/handlers/sftp-auth-handler');
        secrets.getSecret = jest.fn().mockResolvedValue({Password: 'Qwerty1!', HomeDirectory: 'test'});
        let event = {
            "username": "ronw",
            "password": "Qwerty1!",
            "protocol": "SFTP",
            "serverId": "s-f7aa5341076247f2a",
            "sourceIp": "11.11.11.11"
        }

        let result = await authenticator.authenticate(event, {});

        expect(result).toEqual(expect.objectContaining({
            Role: expect.any(String),
            // HomeBucket: expect.any(String),
            // HomeDirectory: '/mybucket/test',
            HomeDirectoryType: 'LOGICAL',
            HomeDirectoryDetails: JSON.stringify([{Entry:"/",Target: `/mybucket/test`}]),
            Policy: expect.any(String)
        }));
    })

    it('Verifies sftp authentication failes when password does not exist', async () => {
        const authenticator = require('../../../src/handlers/sftp-auth-handler');
        secrets.getSecret = jest.fn().mockResolvedValue({});
        let event = {
            "username": "ronw",
            "password": "Qwerty1!",
            "protocol": "SFTP",
            "serverId": "s-f7aa5341076247f2a",
            "sourceIp": "11.11.11.11"
        }

        let result = await authenticator.authenticate(event, {});

        expect(result).toMatchObject({});
    })

    it('Verifies sftp authentication failes when password does not match', async () => {
        const authenticator = require('../../../src/handlers/sftp-auth-handler');
        secrets.getSecret = jest.fn().mockResolvedValue({Password: 'Qwerty2!', HomeDirectory: 'test'});
        let event = {
            "username": "ronw",
            "password": "Qwerty1!",
            "protocol": "SFTP",
            "serverId": "s-f7aa5341076247f2a",
            "sourceIp": "11.11.11.11"
        }

        let result = await authenticator.authenticate(event, {});

        expect(result).toMatchObject({});
    })

    it('Verifies sftp authentication success when IP in whitelist', async () => {
        const authenticator = require('../../../src/handlers/sftp-auth-handler');
        secrets.getSecret = jest.fn().mockResolvedValue({Password: 'Qwerty1!', HomeDirectory: 'test', IPWhiteList: '11.11.11.12,11.11.11.11'});
        let event = {
            "username": "ronw",
            "password": "Qwerty1!",
            "protocol": "SFTP",
            "serverId": "s-f7aa5341076247f2a",
            "sourceIp": "11.11.11.11"
        }

        let result = await authenticator.authenticate(event, {});

        expect(result).toEqual(expect.objectContaining({
            Role: expect.any(String),
            // HomeBucket: expect.any(String),
            // HomeDirectory: '/mybucket/test',
            HomeDirectoryType: 'LOGICAL',
            HomeDirectoryDetails: JSON.stringify([{Entry:"/",Target: `/mybucket/test`}]),
            Policy: expect.any(String)
        }));
    })

    it('Verifies sftp authentication failes when IP not in whitelist', async () => {
        const authenticator = require('../../../src/handlers/sftp-auth-handler');
        secrets.getSecret = jest.fn().mockResolvedValue({Password: 'Qwerty2!', HomeDirectory: 'test', IPWhiteList: '11.11.11.12'});
        let event = {
            "username": "ronw",
            "password": "Qwerty1!",
            "protocol": "SFTP",
            "serverId": "s-f7aa5341076247f2a",
            "sourceIp": "11.11.11.11"
        }

        let result = await authenticator.authenticate(event, {});

        expect(result).toMatchObject({});
    })


    it('Verifies sftp authentication success when IP in whitelist with netmask', async () => {
        const authenticator = require('../../../src/handlers/sftp-auth-handler');
        secrets.getSecret = jest.fn().mockResolvedValue({Password: 'Qwerty1!', HomeDirectory: 'test', IPWhiteList: '11.11.11.12,100.100.100.96/27,11.11.11.11'});
        let event = {
            "username": "ronw",
            "password": "Qwerty1!",
            "protocol": "SFTP",
            "serverId": "s-f7aa5341076247f2a",
            "sourceIp": "100.100.100.99"
        }
    
        let result = await authenticator.authenticate(event, {});
    
        expect(result).toEqual(expect.objectContaining({
            Role: expect.any(String),
            // HomeBucket: expect.any(String),
            // HomeDirectory: '/mybucket/test',
            HomeDirectoryType: 'LOGICAL',
            HomeDirectoryDetails: JSON.stringify([{Entry:"/",Target: `/mybucket/test`}]),
            Policy: expect.any(String)
        }));
    })
})
