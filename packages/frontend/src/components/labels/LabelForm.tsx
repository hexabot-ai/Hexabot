/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Label, LabelGroup } from "@hexabot-ai/types";
import {
  createFilterOptions,
  IconButton,
  InputAdornment,
  ListItem,
  ListItemText,
  TextField,
  Tooltip,
} from "@mui/material";
import { Trash2 } from "lucide-react";
import { FC, Fragment, useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import {
  ConfirmDialogBody,
  ContentContainer,
  ContentItem,
} from "@/app-components/dialogs";
import AutoCompleteEntitySelect from "@/app-components/inputs/AutoCompleteEntitySelect";
import { useCreate } from "@/hooks/crud/useCreate";
import { useDelete } from "@/hooks/crud/useDelete";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useDialogs } from "@/hooks/useDialogs";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, Format } from "@/services/types";
import type { EntityAttributes } from "@/types/base.types";
import { ComponentFormProps } from "@/types/common/dialogs.types";
import { slugify } from "@/utils/string";

const filter = createFilterOptions<LabelGroup>();

type LabelAttributes = EntityAttributes<EntityType.LABEL>;

export const LabelForm: FC<ComponentFormProps<Label>> = ({
  data: { defaultValues: label },
  Wrapper = Fragment,
  WrapperProps,
  ...rest
}) => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const dialogs = useDialogs();
  const options = {
    onError: (error: Error) => {
      rest.onError?.();
      toast.error(error);
    },
    onSuccess: (data: Label) => {
      rest.onSuccess?.(data);
      toast.success(t("message.success_save"));
    },
  };
  const addLabelGroupTitle = t("button.add");
  const [labelGroup, setLabelGroup] = useState<string | null>(
    label?.group || null,
  );
  const { mutate: createLabel } = useCreate(EntityType.LABEL, options);
  const { mutate: createGroupLabel } = useCreate(EntityType.LABEL_GROUP, {
    onSuccess: (createdGroup: LabelGroup) => {
      toast.success(t("message.success_save"));
      // Automatically select the newly created group label
      setLabelGroup(createdGroup.id);
    },
  });
  const { mutate: deleteGroupLabel } = useDelete(EntityType.LABEL_GROUP, {
    onSuccess: () => {
      toast.success(t("message.item_delete_success"));
    },
  });
  const { mutate: updateLabel } = useUpdate(EntityType.LABEL, options);
  const {
    reset,
    register,
    setValue,
    formState: { errors },
    handleSubmit,
  } = useForm<LabelAttributes>({
    defaultValues: {
      name: label?.name || "",
      title: label?.title || "",
      description: label?.description || "",
    },
  });
  const validationRules = {
    title: {
      required: t("message.title_is_required"),
    },
    name: {},
    description: {},
  };
  const onSubmitForm = (params: LabelAttributes) => {
    if (label) {
      updateLabel({
        id: label.id,
        params: {
          group: labelGroup,
          ...params,
        },
      });
    } else {
      createLabel({ group: labelGroup, ...params });
    }
  };

  useEffect(() => {
    if (label) {
      reset({
        name: label.name,
        title: label.title,
        description: label.description,
      });
    } else {
      reset();
    }
  }, [label, reset]);

  return (
    <Wrapper onSubmit={handleSubmit(onSubmitForm)} {...WrapperProps}>
      <form onSubmit={handleSubmit(onSubmitForm)}>
        <ContentContainer>
          <ContentItem>
            <TextField
              label={t("placeholder.title")}
              error={!!errors.title}
              required
              autoFocus
              {...register("title", validationRules.title)}
              slotProps={{
                input: {
                  onChange: ({ target: { value } }) => {
                    setValue("title", value);
                    setValue("name", slugify(value).toUpperCase());
                  },
                },
              }}
              helperText={errors.title ? errors.title.message : null}
            />
          </ContentItem>
          <AutoCompleteEntitySelect<LabelGroup, "name", false>
            fullWidth={true}
            searchFields={["name"]}
            disableSearch
            entity={EntityType.LABEL_GROUP}
            format={Format.BASIC}
            labelKey="name"
            label={t("title.group_label")}
            multiple={false}
            value={labelGroup}
            onChange={(_e, selected) => {
              if (selected && !selected.id && "name" in selected) {
                createGroupLabel({
                  name: selected.name.slice(addLabelGroupTitle.length + 2, -1),
                });
              } else {
                setLabelGroup(selected?.id || null);
              }
            }}
            filterOptions={(options, params) => {
              const filtered = filter(options, params);
              const { inputValue } = params;
              const isExisting = options.some(
                (option) => inputValue === option.name,
              );

              if (inputValue !== "" && !isExisting) {
                filtered.push({
                  id: "",
                  name: `${addLabelGroupTitle} "${inputValue}"`,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                });
              }

              return filtered;
            }}
            renderOption={(props, { id, name }) => (
              <ListItem {...props} key={id}>
                <ListItemText primary={name} />
                {id ? (
                  <InputAdornment
                    position="end"
                    onClick={async () => {
                      const isConfirmed =
                        await dialogs.confirm(ConfirmDialogBody);

                      if (isConfirmed) {
                        deleteGroupLabel(id);
                      }
                    }}
                  >
                    <Tooltip title={t("button.delete")} placement="left" arrow>
                      <IconButton size="small" sx={{ marginRight: 1 }}>
                        <Trash2 size={16} />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ) : null}
              </ListItem>
            )}
            isDisabledWhenEmpty={false}
          />
          <ContentItem>
            <TextField
              placeholder={t("placeholder.name")}
              error={!!errors.name}
              {...register("name", validationRules.name)}
              disabled
              helperText={errors.name ? errors.name.message : null}
            />
          </ContentItem>
          <ContentItem>
            <TextField
              label={t("label.description")}
              error={!!errors.description}
              {...register("description", validationRules.description)}
              helperText={
                errors.description ? errors.description.message : null
              }
              multiline={true}
              minRows={3}
            />
          </ContentItem>
        </ContentContainer>
      </form>
    </Wrapper>
  );
};
