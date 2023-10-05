'use strict'
console.log('INIT');
const awsServerlessExpress = require('aws-serverless-express')
const express = require('express');
const fs = require("fs");
const { toPassportConfig, MetadataReader } = require('passport-saml-metadata');
const MultiSamlStrategy = require('passport-saml').MultiSamlStrategy;
const passport = require('passport');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const db = require('../services/rds-data-service');
const secretService = require('../services/secrets-service');
const redirectUrl = process.env.EligiblityLandingPageHost;

const app = express();

passport.use('saml', new MultiSamlStrategy(
    {
        passReqToCallback: true,
        getSamlOptions: async function (request, done) {
            let [reseller] = await db.getResellerByExternalID(request.params.resellerId);
            if (!reseller[0]) {
                console.log('bad reseller', request.params.resellerId);
                done("error bad reseller");
            }
            try {
                reseller[0].configurations = JSON.parse(reseller[0].configurations);
            } catch (err) {
                console.log('ERROR: Failed parsing reseller configurations');
            }
            
            if (!reseller[0].configurations || !reseller[0].configurations.sso) {
                console.log('ERROR: Failed parsing sku mappings');
                done("error bad reseller configurations");;
            }
            
            // Get IDP metadata
            //const metadataFile = fs.readFileSync(`certs/${process.env.STAGE}-VigrinPlus-metadata.txt`, 'utf8');
            const metadataFile = fs.readFileSync(reseller[0].configurations.sso.cert_filename, 'utf8');
            let buff = Buffer.from(metadataFile, 'base64').toString('utf8');
            const metadata = new MetadataReader(buff.toString('ascii'));
            // Convert metadata to passport options
            const options = toPassportConfig(metadata, { multipleCerts: true });
            if (process.env.UTEST) {
                options.acceptedClockSkewMs = -1;
            }
            done(null, options)
        }
    },
    function (req, profile, done) {
        if (!profile || !profile.attributes) {
            console.log({ profile, message: "no user" });
            done({ message: "no profile or attributes", data: profile });
        }
        // Add profile attributes (employee_name etc.) to request under 'userAttributes'
        done(null, profile.attributes);
    })
);

app.post('/reseller/:resellerId/saml',
    bodyParser.urlencoded({ extended: false }),
    passport.authenticate("saml", { assignProperty: 'userAttributes', failureRedirect: '/', failureFlash: true }),
    async (req, res) => {
        let [reseller] = await db.getResellerByExternalID(req.params.resellerId);
        if (!reseller[0]) {
            console.log('bad reseller', req.params.resellerId);
            return res.redirect(redirectUrl);
        }
        let employer
        let eligibility

        try {
            reseller[0].configurations = JSON.parse(reseller[0].configurations);
        } catch (err) {
            console.log('ERROR: Failed parsing reseller configurations');
        }

        if(req.userAttributes.dario_employer_id){
            [employer] = await db.getEmployer(req.userAttributes.dario_employer_id);
        } else if(req.userAttributes.dario_channel_id) {
            [employer] = await db.getEmployer(req.userAttributes.dario_channel_id.replace(/\D/g, ''));
        } else {
            console.log('bad attributes', req.userAttributes);
            return res.redirect(redirectUrl);
        }
        
        if (!employer[0]) {
            console.log('bad employer', req.userAttributes.dario_employer_id);
            return res.redirect(redirectUrl);
        }

        console.log(JSON.stringify({ req_attributes: req.userAttributes, employer: employer[0] }));
        if(reseller[0].configurations.sso.compare){
            let queryString = `employer_id = ${employer[0].id}`;
            let queryValues = [];
            for (const field of reseller[0].configurations.sso.compare) {
                const fieldKeys = Object.keys(field);
                queryString += ` AND ${field[fieldKeys[0]]}=?`;
                queryValues.push(req.userAttributes[fieldKeys[0]]);
            }
            [eligibility] = await db.getEligibilityByFields(queryString, queryValues);
        } else {
            [eligibility] = await db.getEligibilityByFields(`employer_id = ? AND employee_id=?`, [employer[0].id, req.userAttributes.employee_id]);
        }
        if (!eligibility[0] || !eligibility[0].eid) {
            console.log('bad eid', JSON.stringify(eligibility));
            return res.redirect(redirectUrl + '/' + `emp/${employer[0].external_id}`);
        }

        if (!eligibility[0].reseller_member_id) {
            //update reseller employeer id in the DB
            if (!req.userAttributes.external_id) {
                console.log('bad external_id', JSON.stringify(req.userAttributes));
            } else {
                eligibility[0].reseller_member_id = req.userAttributes.external_id;
                await db.updateEligibility(eligibility[0], eligibility[0].id);
            }
        }

        const privateKey = await secretService.getSecret(`dario/${process.env.STAGE}/id_rsa`);
        let encodePrivateKey = Buffer.from(privateKey.id_rsa, 'base64');
        let expire = 60 * 15;
        const token = jwt.sign({
            data: eligibility[0].eid
        }, encodePrivateKey, { expiresIn: expire, algorithm: 'RS256', header: { kid: 'jYfYhT' } });
        const queryString = `emp/${employer[0].external_id}?auth=${token}`;
        req.body = JSON.stringify({ token });
        console.log('successful redirect', redirectUrl + '/' + queryString);
        res.redirect(303, redirectUrl + '/' + queryString);
    }
)
app.use(function samlErrorHandler(err, req, res, next) {
    console.log("Error: ",err);
    res.redirect(redirectUrl);
});
const server = awsServerlessExpress.createServer(app);
exports.handleAPIRequest = (event, context) => {
    console.log(JSON.stringify({ event, context }));
    awsServerlessExpress.proxy(server, event, context);
}

module.exports.express_app = app;