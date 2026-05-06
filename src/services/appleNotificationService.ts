import {
  OfferDiscountType,
  VerificationException,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library"
import { getSupabaseServiceRole } from "../lib/supabase.js"
import {
  updateUserEntitlementProductFromApple,
  upsertUserEntitlementFromApple,
} from "./entitlementService.js"
import { createAppleSignedDataVerifier } from "./appleVerifierService.js"

type ProcessStatus = "processed" | "ignored" | "duplicate" | "failed"

export class InvalidAppleNotificationPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidAppleNotificationPayloadError"
  }
}

function toIsoString(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return new Date(value).toISOString()
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

/**
 * Trial detection mirrors `appleTransactionService.resolveStatus`: only the
 * FREE_TRIAL discount type is treated as trial. Other offer types (promotional,
 * code, win-back) may carry an `offerType` value but are not free trials.
 */
function inferSubscribedStatus(
  transactionInfo: JWSTransactionDecodedPayload,
): "trial" | "active" {
  if (transactionInfo.offerDiscountType === OfferDiscountType.FREE_TRIAL) {
    return "trial"
  }
  return "active"
}

async function updateLogStatus(params: {
  notificationUUID: string | null
  status: ProcessStatus
  errorMessage?: string
}): Promise<void> {
  if (params.notificationUUID === null) return
  const adminClient = getSupabaseServiceRole()
  const { error } = await adminClient
    .from("apple_notification_logs")
    .update({
      processing_status: params.status,
      error_message: params.errorMessage ?? null,
      processed_at: new Date().toISOString(),
    })
    .eq("notification_uuid", params.notificationUUID)
  if (error !== null) {
    throw new Error(`update apple notification log failed: ${error.message}`)
  }
}

async function safeWriteFailureLog(params: {
  signedPayload: string
  message: string
  notificationUUID?: string | null
  notificationType?: string | null
  subtype?: string | null
}): Promise<void> {
  try {
    const adminClient = getSupabaseServiceRole()
    await adminClient.from("apple_notification_logs").insert({
      notification_uuid: params.notificationUUID ?? null,
      notification_type: params.notificationType ?? null,
      subtype: params.subtype ?? null,
      signed_payload: params.signedPayload,
      processing_status: "failed",
      error_message: params.message,
      processed_at: new Date().toISOString(),
    })
  } catch {
    // Best-effort logging only; avoid masking verifier error.
  }
}

async function findUserIdFromOriginalTransactionId(
  originalTransactionId: string | null,
): Promise<string | null> {
  if (originalTransactionId === null) return null
  const adminClient = getSupabaseServiceRole()
  const { data, error } = await adminClient
    .from("user_entitlements")
    .select("user_id")
    .eq("original_transaction_id", originalTransactionId)
    .maybeSingle<{ user_id: string }>()
  if (error !== null) {
    throw new Error(`lookup user by original_transaction_id failed: ${error.message}`)
  }
  return data?.user_id ?? null
}

export async function processAppleNotification(signedPayload: string): Promise<{
  status: ProcessStatus
  notificationUUID?: string
}> {
  const verifier = createAppleSignedDataVerifier()
  let decodedNotification: ResponseBodyV2DecodedPayload
  try {
    decodedNotification = await verifier.verifyAndDecodeNotification(signedPayload)
  } catch (error) {
    await safeWriteFailureLog({
      signedPayload,
      message: "Notification JWS verification failed",
    })
    const message =
      error instanceof VerificationException
        ? `Notification JWS verification failed (status=${error.status})`
        : "Notification JWS verification failed"
    throw new InvalidAppleNotificationPayloadError(message)
  }

  const notificationUUID = asNonEmptyString(decodedNotification.notificationUUID)
  const notificationType = asNonEmptyString(decodedNotification.notificationType)
  const subtype = asNonEmptyString(decodedNotification.subtype)
  const data = decodedNotification.data ?? null

  let transactionInfo: JWSTransactionDecodedPayload | null = null
  let renewalInfo: JWSRenewalInfoDecodedPayload | null = null

  try {
    const signedTransactionInfo = asNonEmptyString(data?.signedTransactionInfo)
    if (signedTransactionInfo !== null) {
      transactionInfo =
        await verifier.verifyAndDecodeTransaction(signedTransactionInfo)
    }
    const signedRenewalInfo = asNonEmptyString(data?.signedRenewalInfo)
    if (signedRenewalInfo !== null) {
      renewalInfo = await verifier.verifyAndDecodeRenewalInfo(signedRenewalInfo)
    }
  } catch (error) {
    await safeWriteFailureLog({
      signedPayload,
      message: "Nested JWS verification failed",
      notificationUUID,
      notificationType,
      subtype,
    })
    const message =
      error instanceof VerificationException
        ? `Nested JWS verification failed (status=${error.status})`
        : "Nested JWS verification failed"
    throw new InvalidAppleNotificationPayloadError(message)
  }

  const environment = asNonEmptyString(data?.environment) ?? null
  const bundleId = asNonEmptyString(data?.bundleId) ?? null
  const appAppleId =
    typeof data?.appAppleId === "number" ? data.appAppleId : null
  const transactionId = asNonEmptyString(transactionInfo?.transactionId)
  const originalTransactionId =
    asNonEmptyString(transactionInfo?.originalTransactionId) ??
    asNonEmptyString(renewalInfo?.originalTransactionId)
  const productId =
    asNonEmptyString(transactionInfo?.productId) ??
    asNonEmptyString(renewalInfo?.autoRenewProductId) ??
    asNonEmptyString(renewalInfo?.productId)
  const expiresDate = toIsoString(transactionInfo?.expiresDate)
  const gracePeriodExpiresDate = toIsoString(renewalInfo?.gracePeriodExpiresDate)
  const offerType =
    typeof transactionInfo?.offerType === "number" ? transactionInfo.offerType : null
  const rawAppAccountToken = asNonEmptyString(transactionInfo?.appAccountToken)
  const appAccountToken =
    rawAppAccountToken !== null ? rawAppAccountToken.toLowerCase() : null

  const adminClient = getSupabaseServiceRole()
  const { error: insertLogError } = await adminClient
    .from("apple_notification_logs")
    .insert({
      notification_uuid: notificationUUID,
      notification_type: notificationType,
      subtype,
      environment,
      bundle_id: bundleId,
      app_apple_id: appAppleId,
      original_transaction_id: originalTransactionId,
      transaction_id: transactionId,
      product_id: productId,
      signed_payload: signedPayload,
      decoded_payload: decodedNotification,
      decoded_transaction: transactionInfo,
      decoded_renewal_info: renewalInfo,
      processing_status: "received",
    })
  if (insertLogError !== null) {
    // Apple retries the same notification on non-2xx; the unique constraint on
    // notification_uuid is our idempotency key. Do NOT update the existing row's
    // status here — the original processing result must be preserved.
    if (insertLogError.code === "23505" && notificationUUID !== null) {
      return { status: "duplicate", notificationUUID }
    }
    throw new Error(`insert apple notification log failed: ${insertLogError.message}`)
  }

  console.log("[AppleNotification]", {
    notificationUUID,
    notificationType,
    subtype,
    environment,
    productId,
    originalTransactionId,
    transactionId,
    offerType,
    expiresDate,
    gracePeriodExpiresDate,
    appAccountTokenExists: Boolean(appAccountToken),
  })

  const expectedEnvironment = process.env.APPLE_ENVIRONMENT?.trim() ?? ""
  if (environment !== null && expectedEnvironment !== "" && environment !== expectedEnvironment) {
    await updateLogStatus({
      notificationUUID,
      status: "ignored",
      errorMessage: `Environment mismatch: expected ${expectedEnvironment}, got ${environment}`,
    })
    return { status: "ignored", notificationUUID: notificationUUID ?? undefined }
  }

  let userId: string | null = null
  if (appAccountToken !== null) {
    if (!isUuid(appAccountToken)) {
      await updateLogStatus({
        notificationUUID,
        status: "ignored",
        errorMessage: "Invalid appAccountToken UUID",
      })
      return { status: "ignored", notificationUUID: notificationUUID ?? undefined }
    }
    userId = appAccountToken
  } else {
    userId = await findUserIdFromOriginalTransactionId(originalTransactionId)
  }

  if (userId === null) {
    await updateLogStatus({
      notificationUUID,
      status: "ignored",
      errorMessage: "User not found for notification",
    })
    return { status: "ignored", notificationUUID: notificationUUID ?? undefined }
  }

  switch (notificationType) {
    case "SUBSCRIBED": {
      if (transactionInfo === null) {
        await updateLogStatus({
          notificationUUID,
          status: "ignored",
          errorMessage: "SUBSCRIBED missing signedTransactionInfo",
        })
        return { status: "ignored", notificationUUID: notificationUUID ?? undefined }
      }
      const status = inferSubscribedStatus(transactionInfo)
      await upsertUserEntitlementFromApple({
        userId,
        status,
        productId,
        originalTransactionId,
        latestTransactionId: transactionId,
        environment,
        expiresAt: expiresDate,
        trialEndsAt: status === "trial" ? expiresDate : null,
      })
      break
    }
    case "DID_RENEW": {
      await upsertUserEntitlementFromApple({
        userId,
        status: "active",
        productId,
        originalTransactionId,
        latestTransactionId: transactionId,
        environment,
        expiresAt: expiresDate,
        trialEndsAt: null,
      })
      break
    }
    case "DID_FAIL_TO_RENEW": {
      if (gracePeriodExpiresDate !== null && Date.parse(gracePeriodExpiresDate) > Date.now()) {
        await upsertUserEntitlementFromApple({
          userId,
          status: "active",
          productId,
          originalTransactionId,
          latestTransactionId: transactionId,
          environment,
          expiresAt: gracePeriodExpiresDate,
          trialEndsAt: null,
        })
      }
      // Without an active grace period we intentionally do not change
      // entitlement here — final state is confirmed by the EXPIRED notification.
      break
    }
    case "EXPIRED": {
      // TODO: when multiple entitlement sources exist, expires_at should be max across sources.
      await upsertUserEntitlementFromApple({
        userId,
        status: "expired",
        productId,
        originalTransactionId,
        latestTransactionId: transactionId,
        environment,
        expiresAt: expiresDate,
        trialEndsAt: null,
      })
      break
    }
    case "REFUND":
    case "REVOKE": {
      await upsertUserEntitlementFromApple({
        userId,
        status: "expired",
        productId,
        originalTransactionId,
        latestTransactionId: transactionId,
        environment,
        expiresAt: new Date().toISOString(),
        trialEndsAt: null,
      })
      break
    }
    case "DID_CHANGE_RENEWAL_STATUS": {
      await updateLogStatus({
        notificationUUID,
        status: "ignored",
        errorMessage: "Renewal status change does not affect entitlement",
      })
      return { status: "ignored", notificationUUID: notificationUUID ?? undefined }
    }
    case "DID_CHANGE_RENEWAL_PREF": {
      if (productId !== null) {
        await updateUserEntitlementProductFromApple({
          userId,
          productId,
          latestTransactionId: transactionId,
          expiresAt: expiresDate,
        })
      }
      break
    }
    default: {
      await updateLogStatus({
        notificationUUID,
        status: "ignored",
        errorMessage: `Unsupported notification type: ${notificationType ?? "unknown"}`,
      })
      return { status: "ignored", notificationUUID: notificationUUID ?? undefined }
    }
  }

  await updateLogStatus({ notificationUUID, status: "processed" })
  return { status: "processed", notificationUUID: notificationUUID ?? undefined }
}
