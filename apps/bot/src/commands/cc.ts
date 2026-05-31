import {
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import { getPrisma } from "@rdoc-suite/db";
import type { BridgeMode } from "@rdoc-suite/shared";
import {
  addAllowedChannel,
  addCommanderRole,
  ensureGuildConfig,
  getGuildConfig,
  removeAllowedChannel,
  removeCommanderRole,
  setBridgeMode,
  setEnabled,
} from "../services/guildConfig.js";
import { logger } from "../services/logger.js";

const BRIDGE_MODE_CHOICES: { name: string; value: BridgeMode }[] = [
  { name: "External voice bridge (recommended for MVP)", value: "external_voice" },
  { name: "Dedicated Discord voice channel", value: "discord_channel" },
  { name: "Bot relay (experimental)", value: "bot_relay" },
];

export const ccCommandData = new SlashCommandBuilder()
  .setName("cc")
  .setDescription("Channel Commander configuration")
  .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild.toString())
  .setDMPermission(false)
  .addSubcommand((sc) =>
    sc
      .setName("setup")
      .setDescription("Initialize Channel Commander on this server")
      .addStringOption((opt) =>
        opt
          .setName("mode")
          .setDescription("Bridge mode")
          .setRequired(true)
          .addChoices(...BRIDGE_MODE_CHOICES),
      ),
  )
  .addSubcommand((sc) => sc.setName("status").setDescription("Show current configuration"))
  .addSubcommand((sc) => sc.setName("enable").setDescription("Enable the system on this server"))
  .addSubcommand((sc) => sc.setName("disable").setDescription("Disable the system on this server"))
  .addSubcommandGroup((g) =>
    g
      .setName("role")
      .setDescription("Manage commander roles")
      .addSubcommand((sc) =>
        sc
          .setName("add")
          .setDescription("Mark a role as commander role")
          .addRoleOption((opt) =>
            opt.setName("role").setDescription("Role to mark").setRequired(true),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("remove")
          .setDescription("Unmark a commander role")
          .addRoleOption((opt) =>
            opt.setName("role").setDescription("Role to unmark").setRequired(true),
          ),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName("channel")
      .setDescription("Manage participating voice channels")
      .addSubcommand((sc) =>
        sc
          .setName("add")
          .setDescription("Add a voice channel to the system")
          .addChannelOption((opt) =>
            opt
              .setName("channel")
              .setDescription("Voice channel to add")
              .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
              .setRequired(true),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("remove")
          .setDescription("Remove a voice channel from the system")
          .addChannelOption((opt) =>
            opt
              .setName("channel")
              .setDescription("Voice channel to remove")
              .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
              .setRequired(true),
          ),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName("admin")
      .setDescription("Manage who can sign into the web admin UI")
      .addSubcommand((sc) =>
        sc
          .setName("add")
          .setDescription("Authorize a Discord user as an admin for this server")
          .addUserOption((opt) =>
            opt.setName("user").setDescription("User to grant admin access").setRequired(true),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("remove")
          .setDescription("Revoke a Discord user's admin access")
          .addUserOption((opt) =>
            opt.setName("user").setDescription("User to revoke").setRequired(true),
          ),
      )
      .addSubcommand((sc) => sc.setName("list").setDescription("List current admins")),
  )
  ;

export async function handleCc(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({
      content: "This command must be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guildId = interaction.guildId;
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  try {
    if (group === "role" && sub === "add") {
      const role = interaction.options.getRole("role", true);
      const cfg = await addCommanderRole(guildId, role.id);
      await interaction.reply({
        content: `Added <@&${role.id}> as commander role. Total: ${cfg.commanderRoleIds.length}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (group === "role" && sub === "remove") {
      const role = interaction.options.getRole("role", true);
      const cfg = await removeCommanderRole(guildId, role.id);
      await interaction.reply({
        content: `Removed <@&${role.id}> from commander roles. Total: ${cfg.commanderRoleIds.length}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (group === "channel" && sub === "add") {
      const channel = interaction.options.getChannel("channel", true);
      const cfg = await addAllowedChannel(guildId, channel.id);
      await interaction.reply({
        content: `Added <#${channel.id}> as participating channel. Total: ${cfg.allowedVoiceChannelIds.length}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (group === "channel" && sub === "remove") {
      const channel = interaction.options.getChannel("channel", true);
      const cfg = await removeAllowedChannel(guildId, channel.id);
      await interaction.reply({
        content: `Removed <#${channel.id}> from participating channels. Total: ${cfg.allowedVoiceChannelIds.length}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "setup") {
      const mode = interaction.options.getString("mode", true) as BridgeMode;
      await ensureGuildConfig(guildId, { bridgeMode: mode });
      const cfg = await setBridgeMode(guildId, mode);
      await interaction.reply({
        content: `Channel Commander initialized. Mode: \`${cfg.bridgeMode}\`. Use \`/cc role add\` and \`/cc channel add\` next, then \`/cc enable\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "enable") {
      await setEnabled(guildId, true);
      await interaction.reply({
        content: "Channel Commander is now **enabled** on this server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "disable") {
      await setEnabled(guildId, false);
      await interaction.reply({
        content: "Channel Commander is now **disabled** on this server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (group === "admin" && sub === "add") {
      const user = interaction.options.getUser("user", true);
      // Bootstrap rule: the VERY FIRST admin per guild is promoted to
      // "admiral" + protected = true so they cannot be removed or
      // role-edited via the web UI. Subsequent /cc admin add calls
      // produce regular admiral-role admins (non-protected — they can
      // still be managed by the bootstrap admiral via the web UI).
      // Re-adding an existing admin is a no-op (does NOT escalate).
      const existing = await getPrisma().adminUser.count({ where: { guildId } });
      const isBootstrap = existing === 0;
      await getPrisma().adminUser.upsert({
        where: { guildId_userId: { guildId, userId: user.id } },
        create: {
          guildId,
          userId: user.id,
          role: "admiral",
          protected: isBootstrap,
          addedBy: interaction.user.id,
        },
        update: {}, // already-admin: no escalation
      });
      const note = isBootstrap
        ? " Bootstrap-Admin: Admiral + geschützt (kann nicht aus dem Web-UI entfernt werden)."
        : " Admiral (kann von der geschützten Person gemanagt werden).";
      await interaction.reply({
        content: `Granted admin access to <@${user.id}>.${note}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (group === "admin" && sub === "remove") {
      const user = interaction.options.getUser("user", true);
      const res = await getPrisma().adminUser.deleteMany({
        where: { guildId, userId: user.id },
      });
      await interaction.reply({
        content: res.count
          ? `Revoked admin access from <@${user.id}>.`
          : `<@${user.id}> was not an admin.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (group === "admin" && sub === "list") {
      const rows = await getPrisma().adminUser.findMany({
        where: { guildId },
        orderBy: { createdAt: "asc" },
      });
      const body = rows.length
        ? rows.map((r) => `• <@${r.userId}>${r.addedBy ? ` (added by <@${r.addedBy}>)` : " (bootstrap)"}`).join("\n")
        : "_No admins configured yet. Use `/cc admin add @user` to add one._";
      await interaction.reply({
        content: `**Admins on this server (${rows.length}):**\n${body}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "status") {
      const cfg = await getGuildConfig(guildId);
      if (!cfg) {
        await interaction.reply({
          content: "Channel Commander is not configured yet. Run `/cc setup` first.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle("Channel Commander — Status")
        .setColor(cfg.enabled ? 0x2ecc71 : 0xe74c3c)
        .addFields(
          { name: "Enabled", value: cfg.enabled ? "yes" : "no", inline: true },
          { name: "Bridge mode", value: `\`${cfg.bridgeMode}\``, inline: true },
          {
            name: `Commander roles (${cfg.commanderRoleIds.length})`,
            value: cfg.commanderRoleIds.length
              ? cfg.commanderRoleIds.map((id) => `<@&${id}>`).join(", ")
              : "_none configured_",
          },
          {
            name: `Participating channels (${cfg.allowedVoiceChannelIds.length})`,
            value: cfg.allowedVoiceChannelIds.length
              ? cfg.allowedVoiceChannelIds.map((id) => `<#${id}>`).join(", ")
              : "_none configured_",
          },
        );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({
      content: `Unknown subcommand: ${group ? `${group} ` : ""}${sub}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    logger.error({ err, guildId, group, sub }, "command handler failed");
    const message = "Sorry, something went wrong handling that command. The error has been logged.";
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  }
}
