const Company = require('./emission.model').Company;

const CO2_MOLAR_MASS = 44; // g/mol
const AIR_MOLAR_MASS = 29; // g/mol
const AIR_DENSITY = 1.2; // kg/m3
const AIR_VOLUME = 0.5 ** 3; // m3

const DEFAULT_ANNUAL_CARBON_EMISSION_QUOTA = 1000;

const ppmToTons = (ppm, co2_molar_mass = CO2_MOLAR_MASS, air_molar_mass = AIR_MOLAR_MASS, air_density = AIR_DENSITY, air_volume = AIR_VOLUME) => {
    return (ppm * co2_molar_mass * air_density * air_volume) / (air_molar_mass * 10 ** 9);
};

const collect = async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'];

        if (!apiKey) {
            return res.status(400).json({
                status: 'error',
                message: 'API key missing',
                data: {}
            });
        }

        const { ppm, time } = req.body;

        if (!ppm || !time) {
            return res.status(400).json({
                status: 'error',
                message: 'Parameter "ppm" and "time" required',
                data: {}
            });
        }

        const getCompany = await Company.findOne({ apiKey: apiKey });
        if (!getCompany) {
            return res.status(400).json({
                status: 'error',
                message: "Invalid API key",
                data: {}
            });
        }

        const d = new Date(time);
        const year = d.getFullYear().toString();
        const month = `${d.getFullYear()}-${("0" + (d.getMonth()+1).toString()).slice(-2)}`;
        const date = `${d.getFullYear()}-${("0" + (d.getMonth()+1).toString()).slice(-2)}-${("0" + d.getDate().toString()).slice(-2)}`;

        const emissionTon = ppmToTons(ppm);

        const annualEntry = getCompany.emissions.annual.find(e => e.year === year);
        if (annualEntry) {
            annualEntry.totalTon += emissionTon;
        } else {
            getCompany.emissions.annual.push({ year, totalTon: emissionTon });
        }

        const monthlyEntry = getCompany.emissions.monthly.find(e => e.month === month);
        if (monthlyEntry) {
            monthlyEntry.totalTon += emissionTon;
        } else {
            getCompany.emissions.monthly.push({ month, totalTon: emissionTon });
        }

        const dailyEntry = getCompany.emissions.daily.find(e => e.date === date);
        if (dailyEntry) {
            dailyEntry.totalTon += emissionTon;
        } else {
            getCompany.emissions.daily.push({ date, totalTon: emissionTon });
        }

        await getCompany.save();

        res.status(200).json({
            status: "success",
            message: "Successfuly add emission data",
            data: {}
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

const report = async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'];

        if (!apiKey) {
            return res.status(400).json({
                status: 'error',
                message: 'API key missing',
                data: {}
            });
        }

        const { ppm, time } = req.body;

        if (!ppm || !time) {
            return res.status(400).json({
                status: 'error',
                message: 'Parameter "ppm" and "time" required',
                data: {}
            });
        }

        const getCompany = await Company.findOne({ apiKey: apiKey });
        if (!getCompany) {
            return res.status(400).json({
                status: 'error',
                message: "Invalid API key",
                data: {}
            });
        }

        const newReport = {
            ppm: ppm,
            ton: ppmToTons(ppm),
            time: time
        }

        getCompany.reports.push(newReport);

        await getCompany.save();

        res.status(200).json({
            status: "success",
            message: "Successfuly add possible emission manipulation report",
            data: newReport
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

const companies = async (req, res) => {
    try {
        let getCompany = await Company.find({}, { __v: 0, apiKey: 0, reports: 0});
        res.status(200).json({
            status: "success",
            message: "Successfuly read all participating companies",
            data: getCompany.map(({ _id, name, emissions }) => ({ id: _id, name, annual_emissions: emissions.annual.toObject().map(({_id, ...keys}) => keys ) }))
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

const annual = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Parameter "id" required',
                data: {}
            });
        }

        const getCompany = await Company.findOne( { _id: id }, { 'emissions.annual': 1, _id: 0 } );
        if (!getCompany) {
            return res.status(400).json({
                status: 'error',
                message: "Invalid Company ID",
                data: {}
            });
        }

        res.status(200).json({
            status: "success",
            message: "Successfully read company's annual emission",
            data: getCompany.emissions.annual.map(({ year, totalTon }) => ({ year, totalTon }))
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

const monthly = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Parameter "id" required',
                data: {}
            });
        }

        const getCompany = await Company.findOne( { _id: id }, { 'emissions.monthly': 1, _id: 0 } );
        if (!getCompany) {
            return res.status(400).json({
                status: 'error',
                message: "Invalid Company ID",
                data: {}
            });
        }

        res.status(200).json({
            status: "success",
            message: "Successfuly read company's monthly emission",
            data: getCompany.emissions.monthly.map(({ month, totalTon }) => ({ month, totalTon }))
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

const daily = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Parameter "id" required',
                data: {}
            });
        }

        const getCompany = await Company.findOne( { _id: id }, { 'emissions.daily': 1, _id: 0 } );
        if (!getCompany) {
            return res.status(400).json({
                status: 'error',
                message: "Invalid Company ID",
                data: {}
            });
        }

        res.status(200).json({
            status: "success",
            message: "Successfuly read company's daily emission",
            data: getCompany.emissions.daily.map(({ date, totalTon }) => ({ date, totalTon }))
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

const quota = async (req, res) => {
    try {
        const getCompany = await Company.findOne({ publicKey: req.user.publicKey });
        if (!getCompany) {
            return res.status(400).json({
                status: 'error',
                message: "Company not found",
                data: {}
            });
        }

        res.status(200).json({
            status: "success",
            message: "Successfully read company's annual emission current available quota",
            data: getCompany.emissions.annual.toObject().map(item => {
                const year = parseInt(item.year);
                const withdrawalSum = getCompany.quotaWithdrawal.toObject().filter(entry => new Date(entry.time).getFullYear() === year).reduce((sum, entry) => sum + entry.amount, 0);
                return {
                    year: item.year,
                    available_quota: DEFAULT_ANNUAL_CARBON_EMISSION_QUOTA - (item.totalTon + withdrawalSum)
                };
            })
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

const withdraw = async (req, res) => {
    try {
        const getCompany = await Company.findOne({ publicKey: req.user.publicKey });
        if (!getCompany) {
            return res.status(400).json({
                status: 'error',
                message: "Company not found",
                data: {}
            });
        }

        const { amount } = req.body;

        if (!amount) {
            return res.status(400).json({
                status: 'error',
                message: 'Parameter "amount" required',
                data: {}
            });
        }

        const available_quota = getCompany.emissions.annual.toObject().map(item => {
            const year = parseInt(item.year);
            const withdrawalSum = getCompany.quotaWithdrawal.toObject().filter(entry => new Date(entry.time).getFullYear() === year).reduce((sum, entry) => sum + entry.amount, 0);
            return {
                year: item.year,
                available_quota: DEFAULT_ANNUAL_CARBON_EMISSION_QUOTA - (item.totalTon + withdrawalSum)
            };
        }).filter(item => {
            return item.year == new Date().getFullYear().toString();
        })[0].available_quota;

        if (amount > available_quota) {
            return res.status(400).json({
                status: 'error',
                message: 'Not enough carbon quota to withdraw',
                data: {}
            });
        }

        getCompany.quotaWithdrawal.push({
            amount,
            time: new Date()
        });

        await getCompany.save();

        // Mint ECFCH tokens to the company's public key
        const { mint } = require('../../utils/web3/ECFCH_minter');
        const mintResult = await mint(getCompany.publicKey, amount);

        res.status(200).json({
            status: "success",
            message: `Successfully withdraw ${amount} tonnes of carbon quota and minted the tokenized quota`,
            data: {
                mintResult
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

module.exports = {
    collect,
    report,
    companies,
    annual,
    monthly,
    daily,
    quota,
    withdraw
};
