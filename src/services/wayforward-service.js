const got = require('got');
const secrets = require('./secrets-service');

const secretName = `${process.env.STAGE}-employers-elig-wayforward`;

class WayforwardClient {
    constructor() {
        if (!WayforwardClient.instance) {
            console.log(`Creating Dario Client instance...`);
            WayforwardClient.instance = this;

            this.secret = secrets.getSecret(secretName);
            this.accessToken;
        }

        return WayforwardClient.instance;
    }

    async client() {
        let secret = await this.secret;
        if(!this.tokenValid()){
            await this.generateAccessToken();
        }
        
        return got.extend({
            prefixUrl: secret.url,
            responseType: 'json',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.accessToken}`
            }
        });
    }

    tokenValid(){
        try{
            if(this.accessToken){
                let token = JSON.parse(Buffer.from(this.accessToken.split('.')[1], 'base64').toString('binary'));
                return (token.exp * 1000 - Date.now()) > 5000;
            }
            return false;
        }
        catch(err){
            console.error(`ERROR in parsing jwt ${this.accessToken}`, err);
            return false;
        }
    }

    async generateAccessToken(){
        let secret = await this.secret;
        let options = {
            url: `${secret.auth0url}/oauth/token`,
            method: 'POST',
            json: {
                "client_id": secret.client_id,
                "client_secret": secret.client_secret,
                "audience": secret.audience,
                "grant_type":"client_credentials"
            },
            responseType: 'json'
        };

        let response = await got(options);
        console.log(response.body);
        this.accessToken = response.body.access_token;
    }
}


module.exports = {

    createWayforwardUser: async (email, first_name, last_name, phone, gender, birth_year, birth_month, birth_day, dario_ext_id, access_code, eid, isTestUser, country) => {
        let client = await new WayforwardClient().client();
        let secret = await new WayforwardClient().secret;

        let body = {
            "brandId": secret.brand,
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
            "gender": gender,
            "name": `${first_name} ${last_name}`,
            "phone": phone,
            "birth_year": birth_year,
            "birth_month": birth_month,
            "birth_day": birth_day,
            "dario_ext_id": dario_ext_id,
            "access_code": access_code,
            "EID": eid,
            "test_user_ind": isTestUser,
            "country_code": country
        }

        console.log("Wayforward REQ ---> ", body);
        return client.post(`v1/users`, {
            json: body
        });
    }
}