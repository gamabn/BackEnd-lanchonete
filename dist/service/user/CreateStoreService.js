"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateStoreService = void 0;
const database_1 = require("../../database");
const validator_1 = __importDefault(require("validator"));
const bcryptjs_1 = require("bcryptjs");
class CreateStoreService {
    async execute({ name, email, password, phone, city, neighborhood, street, number }) {
        if (!email) {
            throw new Error('Email incorreto');
        }
        const existEmail = await database_1.pool.query('SELECT * FROM restaurants WHERE email = $1', [email]);
        if (existEmail.rows.length > 0) {
            throw new Error('Email já cadastrado');
        }
        if (!validator_1.default.isEmail(email)) {
            throw new Error('Email inválido');
        }
        const hashedPassword = await (0, bcryptjs_1.hash)(password, 8);
        const store = await database_1.pool.query(`INSERT INTO restaurants 
        (name, email, password, phone, city, neighborhood, street, "number") 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`, [name, email, hashedPassword, phone, city, neighborhood, street, number]);
        return store.rows[0];
    }
}
exports.CreateStoreService = CreateStoreService;
