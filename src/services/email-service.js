const AWS = require('aws-sdk');
const nodemailer = require("nodemailer");
const mustache = require('mustache');
const fs = require('fs');
const path = require('path');

const region = "us-east-1";
AWS.config.update({ region });

const templates = {};

// const processing = fs.readFileSync(path.resolve(__dirname, '../templates/processing.html'), 'utf8');
fs.readdirSync(path.resolve(__dirname, '../templates')).forEach(filename => {
    let fileInfo = path.parse(filename)
    templates[fileInfo.name] = fs.readFileSync(path.resolve(__dirname, `../templates/${filename}`), 'utf8');
    // console.log(`loaded template file - ${filename}`);
});

module.exports = {
    sendEmailWithAttachment: async (subject, message, filename, filePayload) => {
        const transporter = nodemailer.createTransport({
            SES: new AWS.SES({ region: 'us-east-1', apiVersion: "2010-12-01" })
        });

        // send mail with defined transport object
        let result = await transporter.sendMail({
            from: process.env.SES_FROM_EMAIL,
            to: process.env.SES_TO_EMAIL,
            subject: subject,                // Subject line
            text: message,                      // plaintext version
            html: `<div><p>${message}</p></div>`, // html version
            attachments: [{
                filename: filename,
                content: filePayload
            }]
        });

        console.log("Message sent: ", result.messageId);
        return result;
    },
        sendEmail: async (subject, message, toMailIds=null) => {
        const transporter = nodemailer.createTransport({
            SES: new AWS.SES({ region: 'us-east-1', apiVersion: "2010-12-01" })
        });

        // send mail with defined transport object
        let result = await transporter.sendMail({
            from: process.env.SES_FROM_EMAIL,
            to: toMailIds || process.env.SES_TO_EMAIL,
            subject: subject,                // Subject line
            text: message,                      // plaintext version
            html: `<div><p>${message}</p></div>` // html version
        });

        console.log("Message sent: ", result.messageId);
        return result;
    },
    sendHtmlEmail: async (subject, html) => {
        const transporter = nodemailer.createTransport({
            SES: new AWS.SES({ region: 'us-east-1', apiVersion: "2010-12-01" })
        });

        // send mail with defined transport object
        let result = await transporter.sendMail({
            from: process.env.SES_FROM_EMAIL,
            to: process.env.SES_TO_EMAIL,
            subject: subject,                // Subject line
            text: 'Available in HTML only...', // plaintext version
            html: `${html}` // html version
        });

        console.log("Message sent: ", result.messageId);
        return result;
    },
    sendTemplateEmail: async (subject, view, templateId) => {
        try {
            
            const transporter = nodemailer.createTransport({
                SES: new AWS.SES({ region: 'us-east-1', apiVersion: "2010-12-01" })
            });
    
            let html = mustache.render(templates[templateId], view);
            console.log("Message testdata: ", process.env.SES_TO_EMAIL, process.env.SES_FROM_EMAIL, subject);
    
            // send mail with defined transport object
            let result = await transporter.sendMail({
                from: process.env.SES_FROM_EMAIL,
                to: process.env.SES_TO_EMAIL,
                subject: subject,                // Subject line
                text: 'Available in HTML only...', // plaintext version
                html: `${html}` // html version
            });
    
            console.log("Message sent: ", result.messageId);
            return result;
        } catch (error) {
            console.log("sendTemplateEmail ", new Error(error).stack)
        }
    },
    sendITSupportEmail: async (subject, view, templateId) => {
        try {
            const transporter = nodemailer.createTransport({
                SES: new AWS.SES({ region: 'us-east-1', apiVersion: "2010-12-01" })
            });
            let html = mustache.render(templates[templateId], view);
            console.log("Message testdata for IT support: ", process.env.SES_TO_EMAIL, process.env.SES_FROM_EMAIL, subject);

            // send mail with defined transport object
            let result = await transporter.sendMail({
                from: process.env.SES_FROM_EMAIL,
                to: process.env.SES_TO_EMAIL,
                subject: subject,                // Subject line
                text: 'Available in HTML only...', // plaintext version
                html: `${html}` // html version
            });

            console.log("Message sent: ", result.messageId);
            return result;
        } catch (error) {
            console.log("sendTemplateEmail ", new Error(error).stack)
        }
    },
    getTemplate: (id) => {
        return templates[id];
    }
}