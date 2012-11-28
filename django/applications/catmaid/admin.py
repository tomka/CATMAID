from django import forms
from django.conf import settings
from django.core.exceptions import ValidationError
from django.contrib import admin
from django.utils.safestring import mark_safe
from guardian.admin import GuardedModelAdmin
from catmaid.models import Project, DataView, Stack, ProjectStack, AnnotationTreeTemplate, AnnotationTreeTemplateNode

class ProjectAdmin(GuardedModelAdmin):
    list_display = ('title', 'public', 'wiki_base_url')
    
#    def has_change_permission(self, request, obj=None):
#        pass

class StackAdmin(GuardedModelAdmin):
    list_display = ('title', 'dimension', 'resolution', 'num_zoom_levels', 'image_base')

class DataViewConfigWidget(forms.widgets.Textarea):
    def render(self, name, value, attrs=None):
        output = super(DataViewConfigWidget, self).render(name, value, attrs)
        output += "<p id='data_view_config_help'></p>"
        return mark_safe(output)

class DataViewAdminForm(forms.ModelForm):
    """ As custom validation is needed for a data views's configuration
    field (it must be JSON data), a custom form is needed, too.
    """
    class Meta:
        model = DataView

    def __init__(self, *args, **kwargs):
        super(DataViewAdminForm, self).__init__(*args, **kwargs)
        # Since we want to add additional information to the data view
        # configuration widget, we decorate it
        self.fields['config'].widget = DataViewConfigWidget(attrs={'class':'vLargeTextField'})
        # The positioning should be handled by a choice field
        num_data_views = DataView.objects.count()
        position_choices = ( (x,str(x)) for x in range(num_data_views) )
        self.fields['position'] = forms.ChoiceField(choices = position_choices)

    def clean_config(self):
        """ Custom validation for tha data view's config field.
        """
        config = self.cleaned_data["config"]
        try:
            import json
            json_data = json.loads( config )
        except:
            raise ValidationError( "Couldn't parse the configuration as JSON data. See e.g. http://en.wikipedia.org/wiki/JSON for examples." )

        return config

class DataViewAdmin(GuardedModelAdmin):
    list_display = ('title', 'data_view_type', 'position', 'is_default', 'comment')
    list_editable = ('position',)
    # Add the custom form which does validation of the view
    # configuration
    form = DataViewAdminForm
    # A custom change form admin view template is needed to display
    # configuraiton information. Since django-guardian is used, which
    # provides a custiom change_form.html template as well, we need
    # to explicitely refer to our wanted template.
    change_form_template = 'admin/catmaid/dataview/change_form.html'

    def add_view(self, request, form_url='', extra_context=None):
        """ The custom view needs the CATMAID URL when adding new
        data views. So pass it to the view.
        """
        extra_context = extra_context or {}
        extra_context['catmaid_url'] = settings.CATMAID_URL
        return super(DataViewAdmin, self).add_view(request, form_url,
            extra_context=extra_context)

    def change_view(self, request, object_id, form_url='', extra_context=None):
        """  The custom view needs the CATMAID URL when editing
        data views. So pass it to the view.
        """
        extra_context = extra_context or {}
        extra_context['catmaid_url'] = settings.CATMAID_URL
        return super(DataViewAdmin, self).change_view(request, object_id,
            form_url, extra_context=extra_context)

class AnnotationTreeTemplateAdmin(GuardedModelAdmin):
    list_display = ('name', 'rootnode')

class AnnotationTreeTemplateNodeAdmin(GuardedModelAdmin):
    ordering = ('position',)
    # Must be in sync with the jsTree based view (URL below)
    list_display = ('pk', 'name', 'class_names', 'parent', 'position', 'relation_name')
    raw_id_fields = ('parent',)
    # we should have all objects on one page
    list_per_page = 900
    list_editable = ('name', 'class_names', 'position', 'parent')

    def parent_id(self, obj):
        return obj.parent and obj.parent_id or '0'

    class Meta:
        model = AnnotationTreeTemplateNode

    class Media:
        js = [settings.CATMAID_URL + 'libs/jquery/jquery.js',
              settings.CATMAID_URL + 'libs/jquery/jquery.jstree.js',
              settings.STATIC_URL + 'js/classification_tree_template_node_admin.js']

admin.site.register(Project, ProjectAdmin)
admin.site.register(DataView, DataViewAdmin)
admin.site.register(Stack, StackAdmin)
admin.site.register(ProjectStack)
admin.site.register(AnnotationTreeTemplate, AnnotationTreeTemplateAdmin)
admin.site.register(AnnotationTreeTemplateNode, AnnotationTreeTemplateNodeAdmin)
