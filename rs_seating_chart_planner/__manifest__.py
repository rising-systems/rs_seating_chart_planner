# -*- coding: utf-8 -*-
{
    'name': 'Seating Chart Planner',
    'summary': '''
        Create and manage visual seating plans.
        Another awesome module by rising systems AG
        ''',
    'version': '1.0.0',
    'author': 'rising systems AG',
    'license': 'Other proprietary',
    'website': 'https://www.rising-systems.de/r/seatingchart',
    'support': 'odoo@rising-systems.de',
    'category': 'Productivity',
    'application': False,
    'installable': True,
    'auto_install': False,
    'images': ['static/description/images/store-cover.gif'],
    'depends': ['base', 'rs_locations_manager'],
    'data': [
        'security/ir.model.access.csv',
        'views/location/admin/rs_location_kanban_inherit.xml',
        'views/location/admin/rs_seating_chart_planner_form_view.xml',
        'views/location/user/rs_location_kanban_inherit.xml',
        'views/location/user/rs_seating_chart_planner_form_view.xml',
        'views/location/user/rs_location_search.xml',
        'views/location/rs_location_seat_assignment_list_view.xml',
        'views/location/rs_location_list_inherit.xml',
        'views/location/rs_location_menu_inherit.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'rs_seating_chart_planner/static/src/components/svg_widget/*',
        ],
    },
}
