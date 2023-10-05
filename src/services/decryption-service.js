const openpgp = require('openpgp');

const decryptEligibilityFile = async (encodedFileStream, secretObject) => {
    console.log("decryptEligibilityFile")
    const privatePgpKey = await decodePrivatePgpKey(secretObject.private_key, secretObject.passphrase);
    console.log("privatePgpKey")

    const encryptedFile = await openpgp.readMessage({binaryMessage: encodedFileStream});
    console.log("encryptedFile")
    const decryptedFile = await openpgp.decrypt({
        message: encryptedFile, 
        decryptionKeys: privatePgpKey,
        config: {
            allowUnauthenticatedMessages: true,
            allowInsecureDecryptionWithSigningKeys: true
        }
    });

    return decryptedFile.data;
}

const decodePrivatePgpKey = async (privatePgpKeyB64, passphrase) => {
    const privatePgpKeyArmored = Buffer.from(privatePgpKeyB64, 'base64');

    return await openpgp.decryptKey({
        privateKey: await openpgp.readPrivateKey({ binaryKey: privatePgpKeyArmored }),
        passphrase: passphrase
    });
}

module.exports = {
    decryptEligibilityFile
}