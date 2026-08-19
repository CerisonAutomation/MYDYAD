import {
  type SqlDataDeletionAnalysis,
  type SqlSchemaMutationAnalysis,
  detectSqlDataDeletion,
  detectSqlSchemaMutation,
} from "pg-schema-classifier";

export function getSqlSchemaMutationAnalysis(
  sql: string,
): SqlSchemaMutationAnalysis {
  return detectSqlSchemaMutation(sql);
}

export function doesSqlMutateSchema(sql: string): boolean {
  return getSqlSchemaMutationAnalysis(sql).mutatesSchema;
}

export function getSqlDataDeletionAnalysis(
  sql: string,
): SqlDataDeletionAnalysis {
  return detectSqlDataDeletion(sql);
}

export function doesSqlDeleteData(sql: string): boolean {
  return getSqlDataDeletionAnalysis(sql).deletesData;
}
