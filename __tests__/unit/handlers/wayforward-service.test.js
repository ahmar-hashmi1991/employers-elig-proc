let got = require('got');
jest.mock('got');
const secrets = require('../../../src/services/secrets-service');
const wayforward = require('../../../src/services/wayforward-service');

function generateJWT(sec) {
    let exp = Math.floor(Date.now()/1000) + sec;
    return `xxxx.${Buffer.from(JSON.stringify({"sub": "1234567890", "name": "John Doe", "exp": exp})).toString('base64')}.yyyy`;
}

describe('Test for wayforward-service', () => {

    beforeAll(() => {
        secrets.getSecret = jest.fn().mockResolvedValue({
            url: 'http://testwayforward.com',
            auth0url: 'https://testauth0.com'
        });
        //omit logging
        console.log = jest.fn();
    });

    afterAll(() => {
    });

    it('Verifies service first call', async () => {
        got.mockResolvedValue({body: {access_token: generateJWT(4)}});
        got.post.mockResolvedValue({body: {}});
        got.extend.mockReturnThis();

        await wayforward.createWayforwardUser(
            'email',
            'first_name',
            'last_name',
            'phone',
            'gender',
            1980,
            5,
            17,
            'dario_ext_id'
        );

        expect(got).toHaveBeenCalledTimes(1);
        expect(got.post).toHaveBeenCalledTimes(1);

        got.mockReset();
        got.post.mockReset();
        got.extend.mockReset();
    });

    it('Verifies service second call twice expired JWT', async () => {
        got.mockResolvedValue({body: {access_token: generateJWT(4)}});
        got.post.mockResolvedValue({body: {}});
        got.extend.mockReturnThis();

        await wayforward.createWayforwardUser('email', 'first_name', 'last_name', 'phone',
            'gender', 1980, 5, 17, 'dario_ext_id'
        );

        await wayforward.createWayforwardUser('email', 'first_name', 'last_name', 'phone',
            'gender', 1980, 5, 17, 'dario_ext_id'
        );

        expect(got).toHaveBeenCalledTimes(2);
        expect(got.post).toHaveBeenCalledTimes(2);

        got.mockReset();
        got.post.mockReset();
        got.extend.mockReset();
    });

    it('Verifies service call twice valid JWT', async () => {
        got.mockResolvedValue({body: {access_token: generateJWT(10)}});
        got.post.mockResolvedValue({body: {}});
        got.extend.mockReturnThis();

        await wayforward.createWayforwardUser('email', 'first_name', 'last_name', 'phone',
            'gender', 1980, 5, 17, 'dario_ext_id'
        );

        await wayforward.createWayforwardUser('email', 'first_name', 'last_name', 'phone',
            'gender', 1980, 5, 17, 'dario_ext_id'
        );

        expect(got).toHaveBeenCalledTimes(1);
        expect(got.post).toHaveBeenCalledTimes(2);

        got.mockReset();
        got.post.mockReset();
        got.extend.mockReset();
    });
})