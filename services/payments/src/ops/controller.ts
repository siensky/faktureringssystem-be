// GET /internal/ops/payments/unknown-bankgiro — driftvyn för rader utan
// tenant (fas 5-planen, avsnitt 5). Under /internal/ specifikt så nginx
// blockerar den utifrån gratis. Inget service_clients-konto seedas för
// scopet som standard (samma resonemang som e2e:s engångsklienter) — en
// operatör som faktiskt behöver polla den lokalt provisionerar en klient
// manuellt.

import type { FastifyReply, FastifyRequest } from "fastify";
import { toUnknownBankgiroDto } from "../transactions/mappers";
import type { BankTransactionRepository } from "../transactions/repository";

export function createOpsController(repo: BankTransactionRepository) {
  return {
    async unknownBankgiro(_request: FastifyRequest, reply: FastifyReply) {
      const rows = await repo.listUnknownBankgiro();
      const transactions = rows.map(toUnknownBankgiroDto);
      return reply.send({ count: transactions.length, transactions });
    },
  };
}
