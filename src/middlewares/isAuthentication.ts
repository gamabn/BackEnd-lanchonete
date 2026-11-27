import type { NextFunction, Request, Response } from "express";
import { verify } from "jsonwebtoken";

interface Payload {
  sub: string;
}

export function isAuthentication(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authToken = req.headers.authorization;

  if (!authToken) {
    // console.log("JWT: cabeçalho Authorization ausente");
    return res.status(401).json({
      error: "Não autenticado.",
    });
  }

  const [scheme, token] = authToken.split(" ");

  if (scheme !== "Bearer" || !token) {
    // console.log("JWT: formato do Authorization inválido");
    return res.status(401).json({
      error: "Token inválido.",
    });
  }

  try {
    const decoded = verify(token, process.env.JWT_SECRET as string) as Payload;

    if (!decoded.sub) {
      // console.log("JWT: propriedade sub ausente");
      return res.status(401).json({
        error: "Token sem identificação do usuário.",
      });
    }

    req.user_id = decoded.sub;

    return next();
  } catch (err) {
    console.error("ERRO AO VALIDAR JWT:", err);

    return res.status(401).json({
      error: "Sessão inválida ou expirada.",
    });
  }
}
