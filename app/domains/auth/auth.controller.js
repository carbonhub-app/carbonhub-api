const Company = require('../emission/emission.model').Company;
const Auth = require('./auth.model').Auth;
const { PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const { signToken } = require('../../utils/auth/jwt/sign');
const { randomUUID } = require('crypto');

const challenge = async (req, res) => {
    try {
        const { publicKey, type } = req.body;

        if (!publicKey || !type) {
            let invalidItems = [];
            if (!publicKey) invalidItems.push('"publicKey"');
            if (!type) invalidItems.push('"type"');
            return res.status(400).json({
                status: 'error',
                message: `Parameter ${invalidItems.join(", ")} required`,
                data: {}
            });
        }

        if (!["user", "company"].includes(type)) {
            return res.status(400).json({
                status: 'error',
                message: `The parameter "type" must be specified as either "user" or "company"`,
                data: {}
            });
        }

        const getAuth = await Auth.findOne({ publicKey: publicKey });
        let challenge = crypto.randomBytes(16).toString('hex');
        if (!getAuth) {
            const newAuth = new Auth({
                publicKey: publicKey,
                type: type,
                latestChallenge: challenge
            });
            await newAuth.save();
        } else {
            getAuth.latestChallenge = challenge;
            await getAuth.save();
        }

        res.status(200).json({
            status: "success",
            message: "Successfuly request new auth challenge",
            data: {
                challenge: challenge
            }
        });
    } catch(err) {
        console.error(err);
        return res.status(400).json({
            status: 'error',
            message: process.env.DEBUG ? err.message : "Bad Request",
            data: {}
        });
    }
};

const verify = async (req, res) => {
    try {
        const { publicKey, challenge, signature } = req.body;

        if (!publicKey || !challenge || !signature) {
            let invalidItems = [];
            if (!publicKey) invalidItems.push('"publicKey"');
            if (!challenge) invalidItems.push('"challenge"');
            if (!signature) invalidItems.push('"signature"');
            return res.status(400).json({
                status: 'error',
                message: `Parameter ${invalidItems.join(", ")} required`,
                data: {}
            });
        }

        const getAuth = await Auth.findOne({ publicKey: publicKey });
        if (!getAuth) {
            return res.status(400).json({
                status: 'error',
                message: "This public key has not initiated any authentication challenge",
                data: {}
            });
        }

        if (challenge != getAuth.latestChallenge) {
            return res.status(400).json({
                status: 'error',
                message: "The challenge code differs from the one previously requested",
                data: {}
            });
        }

        if (challenge != getAuth.latestChallenge) {
            return res.status(400).json({
                status: 'error',
                message: "The challenge code differs from the one previously requested",
                data: {}
            });
        }

        const isValid = nacl.sign.detached.verify(
            new TextEncoder().encode(challenge),
            Buffer.from(signature, 'base64'),
            new PublicKey(publicKey).toBytes()
        );

        if (!isValid) {
            return res.status(400).json({
                status: 'error',
                message: "Invalid signature",
                data: {}
            });
        }

        let getCompany = {};
        if (getAuth.type == "company") {
            getCompany = await Company.findOne({ publicKey: publicKey });
            if (!getCompany) {
                getCompany = new Company({
                    publicKey: publicKey,
                    name: "Company " + publicKey.slice(0, 4) + "..." + publicKey.slice(-4),
                    apiKey: randomUUID()
                });
                await getCompany.save();
            }
        }

        res.status(200).json({
            status: "success",
            message: "Successfuly login as " + getAuth.type,
            data: {
                publicKey: publicKey,
                type: getAuth.type,
                token: signToken({
                    publicKey: publicKey
                }),
                company_id: getCompany._id || null,
                apiKey: getCompany.apiKey || null
            }
        });
    } catch(err) {
        console.error(err);
        return res.status(400).json({
            status: 'error',
            message: process.env.DEBUG ? err.message : "Bad Request",
            data: {}
        });
    }
};

const status = async (req, res) => {
    try {
        const getCompany = await Company.findOne({ publicKey: req.user.publicKey });
        if (!getCompany) {
            return res.status(400).json({
                status: 'error',
                message: "Public key not found or account is not a company",
                data: {}
            });
        }

        res.status(200).json({
            status: "success",
            message: "Successfuly get company status",
            data: {
                publicKey: req.user.publicKey,
                type: "company",
                token: signToken({
                    publicKey: req.user.publicKey
                }),
                company_id: getCompany._id,
                apiKey: getCompany.apiKey
            }
        });
    } catch(err) {
        console.error(err);
        return res.status(400).json({
            status: 'error',
            message: process.env.DEBUG ? err.message : "Bad Request",
            data: {}
        });
    }
}

module.exports = {
    challenge,
    verify,
    status
};