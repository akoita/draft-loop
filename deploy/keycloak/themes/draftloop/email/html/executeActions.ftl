<#-- The beta invite: the API creates the invited person's account and asks for this email with
     the single action UPDATE_PASSWORD. Any other action list keeps Keycloak's own wording. -->
<#outputformat "plainText">
<#assign requiredActionsText><#if requiredActions??><#list requiredActions><#items as reqActionItem>${msg("requiredAction.${reqActionItem}")}<#sep>, </#sep></#items></#list></#if></#assign>
</#outputformat>
<#assign invite = (requiredActions?? && requiredActions?size == 1 && requiredActions[0] == "UPDATE_PASSWORD")>
<#import "template.ftl" as layout>
<@layout.emailLayout>
<#if invite>
<div style="background:#FBFAF7;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#14181D;">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E3E1DA;border-radius:8px;padding:32px;">
    <p style="margin:0 0 24px;font-size:20px;font-weight:bold;letter-spacing:0.04em;">Redakloop</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${msg("draftloopInviteHeading")}</h1>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">${msg("draftloopInviteIntro")}</p>
    <p style="margin:0 0 24px;">
      <a href="${link}" style="display:inline-block;background:#0F6B5F;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:bold;padding:12px 24px;border-radius:6px;">${msg("draftloopInviteButton")}</a>
    </p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">${msg("draftloopInviteExpiry", linkExpirationFormatter(linkExpiration))}</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">${msg("draftloopInviteIgnore")}</p>
    <p style="margin:0;font-size:14px;line-height:1.5;">${msg("draftloopInviteSignature")}</p>
  </div>
</div>
<#else>
${kcSanitize(msg("executeActionsBodyHtml",link, linkExpiration, realmName, requiredActionsText, linkExpirationFormatter(linkExpiration)))?no_esc}
</#if>
</@layout.emailLayout>
