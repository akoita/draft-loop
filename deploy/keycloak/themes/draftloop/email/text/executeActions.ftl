<#ftl output_format="plainText">
<#-- The beta invite's text part; see html/executeActions.ftl. -->
<#assign requiredActionsText><#if requiredActions??><#list requiredActions><#items as reqActionItem>${msg("requiredAction.${reqActionItem}")}<#sep>, </#items></#list><#else></#if></#assign>
<#assign invite = (requiredActions?? && requiredActions?size == 1 && requiredActions[0] == "UPDATE_PASSWORD")>
<#if invite>
${msg("draftloopInviteHeading")}

${msg("draftloopInviteIntro")}

${msg("draftloopInviteButton")}
${link}

${msg("draftloopInviteExpiry", linkExpirationFormatter(linkExpiration))}

${msg("draftloopInviteIgnore")}

${msg("draftloopInviteSignature")}
<#else>
${msg("executeActionsBody",link, linkExpiration, realmName, requiredActionsText, linkExpirationFormatter(linkExpiration))}
</#if>
