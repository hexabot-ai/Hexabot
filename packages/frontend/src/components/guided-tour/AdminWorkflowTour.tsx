/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Workflow as WorkflowHelper } from "@hexabot-ai/agentic";
import { Action } from "@hexabot-ai/types";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import {
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { alpha, useColorScheme, useTheme } from "@mui/material/styles";
import { X } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type EventData,
  Joyride,
  type Step,
  type TooltipRenderProps,
} from "react-joyride";

import { isLicenseQuotaReached } from "@/components/license/license-quotas";
import { useCreate } from "@/hooks/crud/useCreate";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useAuth } from "@/hooks/useAuth";
import { useHasPermission } from "@/hooks/useHasPermission";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, RouterType } from "@/services/types";

import { createBaseDefinition } from "../visual-editor/v4/utils/workflow-definition.utils";

import {
  ADMIN_WORKFLOW_TOUR_CLICK_THROUGH_SELECTORS,
  ADMIN_WORKFLOW_TOUR_SELECTORS,
  buildAdminWorkflowTourWorkflowPayload,
  getAdminWorkflowTourTransition,
  isAdminWorkflowTourCompleted,
  isAdminWorkflowTourContinuationAllowed,
  isAdminWorkflowTourDashboardRoute,
  isAdminWorkflowTourEligible,
  isAdminWorkflowTourWorkflowEditorRoute,
  markAdminWorkflowTourCompleted,
  removeAdminWorkflowTourSpotlightProxy,
  waitForAdminWorkflowTourTarget,
} from "./admin-workflow-tour.utils";

type TourWorkflowCreatePayload = ReturnType<
  typeof buildAdminWorkflowTourWorkflowPayload
>;

const getTooltipLabel = (title: ReactNode, content: ReactNode) => {
  if (typeof title === "string") {
    return title;
  }

  if (typeof content === "string") {
    return content;
  }

  return undefined;
};
const AdminWorkflowTourTooltip = ({
  backProps,
  closeProps,
  index,
  isLastStep,
  primaryProps,
  skipProps,
  step,
  size,
  tooltipProps,
}: TooltipRenderProps) => {
  // Joyride v3 replaced the per-step `hide*`/`showSkipButton` flags with a
  // single `buttons` allow-list on the merged step.
  const { buttons, content, styles, title } = step;
  const theme = useTheme();
  const tooltipLabel = getTooltipLabel(title, content);
  const hideCloseButton = !buttons.includes("close");
  const hideFooter = !["back", "primary", "skip"].some((button) =>
    buttons.includes(button as (typeof buttons)[number]),
  );
  const showBack = buttons.includes("back") && index > 0;
  const showSkip = buttons.includes("skip") && !isLastStep;

  return (
    <Paper
      aria-label={tooltipLabel}
      className="react-joyride__tooltip"
      elevation={0}
      style={{
        ...styles.tooltip,
        backgroundImage: `linear-gradient(135deg, rgba(${theme.vars.palette.primary.mainChannel} / 0.1) 0%, rgba(${theme.vars.palette.primary.mainChannel} / 0) 44%)`,

        borderRadius: theme.shape.borderRadius,
        color: theme.vars.palette.text.primary,
        padding: 0,
      }}
      {...tooltipProps}
    >
      <Box sx={{ p: 2.25, position: "relative" }}>
        {!hideCloseButton ? (
          <IconButton
            size="small"
            sx={{
              color: "text.secondary",
              position: "absolute",
              right: 12,
              top: 12,
              "&:hover": {
                bgcolor: `rgba(${theme.vars.palette.primary.mainChannel} / 0.08)`,
                color: "text.primary",
              },
            }}
            type="button"
            {...closeProps}
          >
            <X aria-hidden="true" size={18} strokeWidth={2.25} />
            <Box
              component="span"
              sx={{
                border: 0,
                clip: "rect(0 0 0 0)",
                height: 1,
                m: -1,
                overflow: "hidden",
                p: 0,
                position: "absolute",
                whiteSpace: "nowrap",
                width: 1,
              }}
            >
              {closeProps.title}
            </Box>
          </IconButton>
        ) : null}
        <Stack spacing={2}>
          <Stack
            alignItems="flex-start"
            direction="row"
            spacing={1.5}
            sx={{ pr: hideCloseButton ? 0 : 3.5 }}
          >
            <Box
              aria-hidden="true"
              sx={{
                alignItems: "center",
                bgcolor: `rgba(${theme.vars.palette.primary.mainChannel} / 0.12)`,
                borderRadius: 1,
                color: "primary.main",
                display: "flex",
                flexShrink: 0,
                height: 36,
                justifyContent: "center",
                width: 36,
              }}
            >
              <AutoAwesomeRoundedIcon fontSize="small" />
            </Box>
            <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
              <Stack
                alignItems="center"
                direction="row"
                justifyContent="space-between"
                spacing={1}
              >
                {title ? (
                  <Typography
                    component="h2"
                    sx={{ fontWeight: 700, lineHeight: 1.3 }}
                    variant="subtitle1"
                  >
                    {title}
                  </Typography>
                ) : null}
                <Chip
                  color="primary"
                  label={`${index + 1}/${size}`}
                  size="small"
                  sx={{ flexShrink: 0 }}
                />
              </Stack>
              <Typography
                color="text.secondary"
                component="div"
                sx={{ lineHeight: 1.55 }}
                variant="body2"
              >
                {content}
              </Typography>
            </Stack>
          </Stack>
          {!hideFooter ? (
            <Stack
              alignItems="center"
              direction="row"
              justifyContent="space-between"
              spacing={1}
            >
              <Box>
                {showSkip ? (
                  <Button
                    color="inherit"
                    size="small"
                    type="button"
                    variant="text"
                    {...skipProps}
                  >
                    {skipProps.title}
                  </Button>
                ) : null}
              </Box>
              <Stack direction="row" spacing={1}>
                {showBack ? (
                  <Button
                    color="primary"
                    size="small"
                    type="button"
                    variant="outlined"
                    {...backProps}
                  >
                    {backProps.title}
                  </Button>
                ) : null}
                <Button
                  color="primary"
                  size="small"
                  type="button"
                  variant="contained"
                  {...primaryProps}
                >
                  {primaryProps.title}
                </Button>
              </Stack>
            </Stack>
          ) : null}
        </Stack>
      </Box>
    </Paper>
  );
};

export const AdminWorkflowTour = () => {
  const router = useAppRouter();
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const tooltipBg = isDark ? theme.palette.grey[700] : theme.palette.grey[100];
  const { user, isAuthenticated, refetchUser } = useAuth();
  const hasPermission = useHasPermission();
  const { toast } = useToast();
  const { t } = useTranslate();
  const userId = user?.id;
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [pendingStepIndex, setPendingStepIndex] = useState<number | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  const [createRequested, setCreateRequested] = useState(false);
  const [createdWorkflowId, setCreatedWorkflowId] = useState<string | null>(
    null,
  );
  const [isCompleted, setIsCompleted] = useState(() =>
    isAdminWorkflowTourCompleted(userId),
  );
  const createInFlightRef = useRef(false);
  const clickThroughTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const canReadWorkflow = hasPermission(EntityType.WORKFLOW, Action.READ);
  const canCreateWorkflow = hasPermission(EntityType.WORKFLOW, Action.CREATE);
  const workflowQuotaReached = isLicenseQuotaReached(
    user?.license,
    "workflows",
  );
  const isEligible = isAdminWorkflowTourEligible({
    canCreateWorkflow,
    canReadWorkflow,
    isAuthenticated,
    isCompleted,
    userId,
    workflowQuotaReached,
  });
  const canContinueTour = isAdminWorkflowTourContinuationAllowed({
    canCreateWorkflow,
    canReadWorkflow,
    hasStarted,
    isAuthenticated,
    isCompleted,
    isStopped,
    userId,
  });
  const isDashboardRoute = isAdminWorkflowTourDashboardRoute(router.pathname);
  const isWorkflowEditorRoute = isAdminWorkflowTourWorkflowEditorRoute(
    router.pathname,
  );
  const blankDefinitionYml = useMemo(
    () => WorkflowHelper.stringifyDefinition(createBaseDefinition()),
    [],
  );
  const workflowNamePrefix = t(
    "visual_editor.guided_tour.workflow_name_prefix",
  );
  const steps = useMemo<Step[]>(
    () => [
      {
        target: ADMIN_WORKFLOW_TOUR_SELECTORS.dashboardCreate,
        title: t("visual_editor.guided_tour.dashboard_create.title"),
        content: t("visual_editor.guided_tour.dashboard_create.content"),
        placement: "bottom",
      },
      {
        target: ADMIN_WORKFLOW_TOUR_SELECTORS.emptyInsert,
        title: t("visual_editor.guided_tour.empty_insert.title"),
        content: t("visual_editor.guided_tour.empty_insert.content"),
        placement: "right",
      },
      {
        target: ADMIN_WORKFLOW_TOUR_SELECTORS.insertStep,
        title: t("visual_editor.guided_tour.insert_step.title"),
        content: t("visual_editor.guided_tour.insert_step.content"),
        placement: "right",
      },
      {
        target: ADMIN_WORKFLOW_TOUR_SELECTORS.sendTextActionSpotlight,
        title: t("visual_editor.guided_tour.send_text_action.title"),
        content: t("visual_editor.guided_tour.send_text_action.content"),
        isFixed: true,
        placement: "left",
      },
      {
        target: ADMIN_WORKFLOW_TOUR_SELECTORS.actionSave,
        title: t("visual_editor.guided_tour.action_save.title"),
        content: t("visual_editor.guided_tour.action_save.content"),
        placement: "left-end",
      },
      {
        target: ADMIN_WORKFLOW_TOUR_SELECTORS.chatWidget,
        title: t("visual_editor.guided_tour.chat_widget.title"),
        content: t("visual_editor.guided_tour.chat_widget.content"),
        // Final step is informational: show the Done button and stop letting
        // clicks fall through to the highlighted element.
        blockTargetInteraction: true,
        buttons: ["close", "primary"],
        placement: "top",
      },
    ],
    [t],
  );
  const stopTour = useCallback(() => {
    removeAdminWorkflowTourSpotlightProxy();
    setRun(false);
    setPendingStepIndex(null);
    setIsStopped(true);
  }, []);
  const completeTour = useCallback(() => {
    removeAdminWorkflowTourSpotlightProxy();
    setRun(false);
    setPendingStepIndex(null);
    setIsStopped(true);
    setIsCompleted(true);
    markAdminWorkflowTourCompleted(userId);
  }, [userId]);
  const { mutate: createWorkflow } = useCreate<
    EntityType.WORKFLOW,
    TourWorkflowCreatePayload
  >(EntityType.WORKFLOW, {
    onError: (error) => {
      createInFlightRef.current = false;
      setCreateRequested(false);
      stopTour();
      toast.error(error);
    },
  });

  useEffect(() => {
    setIsCompleted(isAdminWorkflowTourCompleted(userId));
    setHasStarted(false);
    setIsStopped(false);
    setCreateRequested(false);
    setCreatedWorkflowId(null);
    createInFlightRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (!isEligible || !isDashboardRoute || hasStarted || isStopped) {
      return;
    }

    setHasStarted(true);
    setPendingStepIndex(0);
  }, [hasStarted, isDashboardRoute, isEligible, isStopped]);

  useEffect(() => {
    if (
      !createRequested ||
      !canContinueTour ||
      !isWorkflowEditorRoute ||
      createdWorkflowId ||
      createInFlightRef.current
    ) {
      return;
    }

    createInFlightRef.current = true;
    setRun(false);
    createWorkflow(
      buildAdminWorkflowTourWorkflowPayload({
        definitionYml: blankDefinitionYml,
        workflowNamePrefix,
      }),
      {
        onSuccess: (workflow) => {
          setCreatedWorkflowId(workflow.id);
          void refetchUser();
          void router
            .push(`/${RouterType.WORKFLOW_EDITOR}/${workflow.id}`)
            .then(() => {
              setPendingStepIndex(1);
            });
        },
      },
    );
  }, [
    blankDefinitionYml,
    canContinueTour,
    createRequested,
    createWorkflow,
    createdWorkflowId,
    isWorkflowEditorRoute,
    refetchUser,
    router,
    workflowNamePrefix,
  ]);

  useEffect(() => {
    if (pendingStepIndex === null || !canContinueTour) {
      return;
    }

    const target = steps[pendingStepIndex]?.target;

    if (typeof target !== "string") {
      return;
    }

    let cancelled = false;

    setRun(false);
    waitForAdminWorkflowTourTarget(target)
      .then(() => {
        if (cancelled) {
          return;
        }

        setStepIndex(pendingStepIndex);
        setPendingStepIndex(null);
        setRun(true);
      })
      .catch(() => {
        if (!cancelled) {
          stopTour();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canContinueTour, pendingStepIndex, steps, stopTour]);

  useEffect(() => {
    const clickThroughSelector =
      ADMIN_WORKFLOW_TOUR_CLICK_THROUGH_SELECTORS[stepIndex];

    if (!run || !clickThroughSelector) {
      return;
    }

    const handleClickThrough = (event: MouseEvent) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (!target.closest(clickThroughSelector)) {
        return;
      }

      if (clickThroughTimerRef.current) {
        clearTimeout(clickThroughTimerRef.current);
      }

      clickThroughTimerRef.current = setTimeout(() => {
        clickThroughTimerRef.current = null;
        setRun(false);
        if (stepIndex === 0) {
          setCreateRequested(true);

          return;
        }

        setPendingStepIndex(stepIndex + 1);
      }, 0);
    };

    document.addEventListener("click", handleClickThrough, true);

    return () => {
      document.removeEventListener("click", handleClickThrough, true);
      if (clickThroughTimerRef.current) {
        clearTimeout(clickThroughTimerRef.current);
        clickThroughTimerRef.current = null;
      }
    };
  }, [run, stepIndex]);

  const handleJoyrideEvent = useCallback(
    (data: EventData) => {
      const transition = getAdminWorkflowTourTransition({
        action: data.action,
        index: data.index,
        size: data.size,
        status: data.status,
        type: data.type,
      });

      if (transition.complete) {
        completeTour();

        return;
      }

      if (transition.stop) {
        stopTour();

        return;
      }

      if (transition.retryStepIndex !== undefined) {
        setRun(false);
        setPendingStepIndex(transition.retryStepIndex);

        return;
      }

      if (transition.nextStepIndex !== undefined) {
        setRun(false);
        setPendingStepIndex(transition.nextStepIndex);
      }
    },
    [completeTour, stopTour],
  );

  if (!hasStarted && !run) {
    return null;
  }

  return (
    <Joyride
      continuous
      locale={{
        back: t("button.back"),
        close: t("button.close"),
        last: t("button.done"),
        next: t("button.next"),
        skip: t("button.skip"),
      }}
      onEvent={handleJoyrideEvent}
      // Joyride v3 folds theming and per-step behavior flags into `options`.
      // Steps are driven click-through, so only the close button is rendered
      // and the target stays interactive (`blockTargetInteraction` default).
      options={{
        arrowColor: tooltipBg,
        backgroundColor: tooltipBg,
        buttons: ["close"],
        overlayClickAction: false,
        // v2 dimmed the page by blending an opaque overlay with
        // `mixBlendMode: hard-light`; v3 fills the overlay SVG directly and
        // strips that blend mode, so an opaque color paints a solid sheet over
        // the app. These alphas reproduce what hard-light used to compute: a
        // 40% black scrim in light mode, a 20% white veil in dark mode.
        overlayColor: isDark
          ? alpha(theme.palette.common.white, 0.2)
          : alpha(theme.palette.common.black, 0.4),
        primaryColor: theme.vars.palette.primary.main,
        skipBeacon: true,
        skipScroll: true,
        spotlightPadding: 8,
        textColor: theme.vars.palette.text.primary,
        zIndex: theme.zIndex.modal + 100,
      }}
      run={run}
      stepIndex={stepIndex}
      steps={steps}
      tooltipComponent={AdminWorkflowTourTooltip}
    />
  );
};
