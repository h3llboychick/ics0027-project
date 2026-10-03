import * as argon2 from "argon2";

export const PASSWORD_HASHING_OPTIONS : argon2.HashOptions = {
    type: argon2.argon2id,
    memoryCost: 47104,
    timeCost: 1,
    parallelism: 1
} // values for options taken from: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

export async function hash( password: string) {
    return argon2.hash(password, PASSWORD_HASHING_OPTIONS);
}

export async function verify({ hash, password } : { hash: string, password: string }) {
    try {
        return argon2.verify(hash, password, PASSWORD_HASHING_OPTIONS);
    } catch (err) {
        console.error("error while verifying hash", err) ;
        return false; // fail safe - if something goes wrong on our side it's better to deny authentication rather than allow it
    }
}